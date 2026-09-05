import { nextRunAt, parseCadence, type Env, type Logger } from '@gather/core';
import {
  advanceSchedule,
  appendAuditEvent,
  claimDueSchedules,
  claimReminder,
  deferSchedule,
  findReminderTarget,
  outstandingItems,
  recordReminderResult,
  stopSchedule,
  type Database,
  type DbTransaction,
  type DueReminder,
  type ReminderTarget,
} from '@gather/db';
import { MailError, renderReminderEmail, renderRequestEmail, type MailDriver } from '@gather/mail';

/**
 * One pass of the reminder engine.
 *
 * The shape is deliberately boring: find what is due, send it, write down what happened.
 * All the interesting decisions live elsewhere — when a reminder is due is
 * `nextRunAt` in @gather/core, and whether it may be sent at all is a unique index in
 * Postgres. This file is what connects them, and it is written so that being killed at any
 * line between them cannot produce a second email.
 *
 * The order matters and is the whole design:
 *
 *   1. Lock the schedule row (`FOR UPDATE SKIP LOCKED`) — two workers never race.
 *   2. Insert the log row with a derived idempotency key — a *restarted* worker never races
 *      either, because the key it recomputes is already taken.
 *   3. Send.
 *   4. Record the outcome and move the schedule on.
 *
 * A crash between 2 and 3 loses one reminder. A crash between 3 and 4 leaves a row that
 * says `queued` for a message that went out. Both are recoverable and visible; sending
 * twice is neither, which is why the guard is before the send rather than after it.
 */

export interface ReminderDeps {
  db: Database;
  mail: MailDriver;
  logger: Logger;
  config: Env;
  /** Injected so tests can move time rather than wait for it. */
  now?: () => Date;
}

export interface ScanResult {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  stopped: number;
}

/** Reasons a due schedule produced no email. Each one is logged by name. */
type SkipReason =
  'no-client-email' | 'already-claimed' | 'nothing-outstanding' | 'mail-not-configured';

export async function runReminderScan(deps: ReminderDeps): Promise<ScanResult> {
  const now = deps.now?.() ?? new Date();
  const result: ScanResult = { considered: 0, sent: 0, skipped: 0, failed: 0, stopped: 0 };

  // Everything happens inside one transaction so the row locks taken by
  // `claimDueSchedules` are held for as long as the sends they protect.
  await deps.db.transaction(async (tx) => {
    const due = await claimDueSchedules(deps.db, now, deps.config.GATHER_REMINDER_BATCH);
    result.considered = due.length;

    for (const reminder of due) {
      const outcome = await sendOne(deps, tx, reminder, now);
      if (outcome === 'sent') result.sent += 1;
      else if (outcome === 'failed') result.failed += 1;
      else if (outcome === 'stopped') result.stopped += 1;
      else result.skipped += 1;
    }
  });

  return result;
}

type Outcome = 'sent' | 'failed' | 'stopped' | SkipReason;

async function sendOne(
  deps: ReminderDeps,
  tx: DbTransaction,
  reminder: DueReminder,
  now: Date,
): Promise<Outcome> {
  const { schedule } = reminder;
  const log = deps.logger.child({ requestId: reminder.requestId, scheduleId: schedule.id });

  // `client.email` is NOT NULL and the form that writes it requires an address, so this
  // is not the ordinary path — it is what a CSV import or a hand-edited row can leave
  // behind. Stop rather than retry: nothing here fixes itself, and a schedule that fails
  // every minute for a month is noise that hides the failures worth reading.
  if (!reminder.clientEmail.trim()) {
    await stopSchedule(tx, reminder.requestId, 'the client has no email address', {
      firmId: reminder.firmId,
    });
    log.warn('reminder schedule stopped: the client has no email address');
    return 'stopped';
  }

  const outstanding = await outstandingItems(tx, reminder.requestId);
  if (outstanding.requiredMissing === 0) {
    // The client finished between one scan and the next. Nagging somebody for documents
    // they have already sent is the single most damaging thing this system could do.
    await stopSchedule(tx, reminder.requestId, 'everything required is in', {
      firmId: reminder.firmId,
    });
    log.info('reminder schedule stopped: everything required is in');
    return 'stopped';
  }

  // Derived, not random: a worker that dies after this insert and restarts computes the
  // same key, collides, and declines to send the same reminder twice.
  const idempotencyKey = `schedule:${schedule.id}:${schedule.sentCount}`;

  const claimed = await claimReminder(tx, {
    requestId: reminder.requestId,
    scheduleId: schedule.id,
    toAddress: reminder.clientEmail,
    idempotencyKey,
  });

  if (!claimed) {
    log.warn('reminder was already claimed — not sending a second copy', { idempotencyKey });
    return 'already-claimed';
  }

  const cadence = parseCadence(schedule.cadence);
  const email = buildEmail(deps.config, reminder, outstanding, schedule.sentCount);

  try {
    const sent = await deps.mail.send({
      to: reminder.clientEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey,
      headers: {
        // So a client can filter or unsubscribe at the mail-client level, and so replies
        // thread against the request rather than scattering.
        'X-Gather-Request': reminder.requestId,
      },
    });

    await recordReminderResult(tx, claimed.id, {
      status: 'sent',
      providerMessageId: sent.providerMessageId,
    });

    const next = nextRunAt(
      cadence,
      { startedAt: startOf(reminder), lastSentAt: now, sentCount: schedule.sentCount + 1 },
      now,
    );
    await advanceSchedule(tx, schedule.id, next);

    log.info('reminder sent', {
      to: redactEmail(reminder.clientEmail),
      driver: sent.driver,
      providerMessageId: sent.providerMessageId,
      outstanding: outstanding.labels.length,
      nextRunAt: next?.toISOString() ?? null,
    });
    return 'sent';
  } catch (error) {
    const failure = error instanceof MailError ? error : null;
    const message = (error as Error).message;

    await recordReminderResult(tx, claimed.id, {
      status: failure?.retryable ? 'deferred' : 'failed',
      error: message,
    });

    if (failure?.retryable) {
      // The claim row stays, so the retry reuses the same idempotency key and remains the
      // same reminder. `sentCount` is untouched for the same reason.
      const retryAt = new Date(now.getTime() + backoffMs(schedule.sentCount));
      await deferSchedule(tx, schedule.id, retryAt);
      log.warn('reminder deferred after a retryable failure', { retryAt, error: message });
    } else {
      await stopSchedule(tx, reminder.requestId, `email could not be sent: ${message}`, {
        firmId: reminder.firmId,
      });
      log.error('reminder schedule stopped after a permanent failure', { error: message });
    }

    return 'failed';
  }
}

/**
 * When the clock starts for an escalating ladder.
 *
 * `request.sent_at` if the request was ever sent; otherwise the schedule's own creation,
 * which is what a schedule attached to a draft has to fall back on.
 */
function startOf(reminder: DueReminder): Date {
  return reminder.sentAt ?? reminder.schedule.createdAt;
}

function buildEmail(
  config: Env,
  reminder: ReminderTarget,
  outstanding: { labels: string[]; total: number },
  sentCount: number,
) {
  const snapshot = (reminder.brandSnapshot ?? null) as {
    name?: string;
    logoUrl?: string | null;
    brandColor?: string;
  } | null;

  const content = {
    brand: {
      firmName: snapshot?.name ?? reminder.firmName,
      color: snapshot?.brandColor ?? reminder.firmColor,
      logoUrl: snapshot?.logoUrl ?? reminder.firmLogoUrl,
    },
    clientName: reminder.clientName,
    requestTitle: reminder.requestTitle,
    // The portal link is per-request; the client already has one from the first email.
    // Sending them to the request path means an expired token shows the "ask for a fresh
    // link" page rather than a 404.
    portalUrl: new URL(`/portal/${reminder.requestId}`, config.GATHER_APP_URL).toString(),
    outstanding: outstanding.labels,
    totalItems: outstanding.total,
    dueAt: reminder.dueAt,
    reminderNumber: sentCount + 1,
  };

  return sentCount === 0 ? renderRequestEmail(content) : renderReminderEmail(content);
}

/**
 * How long to wait after a retryable failure.
 *
 * Exponential from one minute, capped at an hour. A mail server that is down usually comes
 * back within minutes; one that is down for longer is not going to be fixed by us asking
 * more often, and an hourly retry keeps the log readable.
 */
function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.min(attempt, 6));
}

/** `r***@example.com` — enough to tell which client, not enough to be a leak in a log file. */
function redactEmail(address: string): string {
  const at = address.indexOf('@');
  if (at <= 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

export type ManualResult =
  { ok: true; providerMessageId: string | null } | { ok: false; error: string };

/**
 * A one-off send the firm asked for by pressing "Send a reminder now".
 *
 * Shares the claim-then-send path, so it cannot produce two emails and cannot race the
 * worker. Two things differ from a scheduled reminder, both deliberate:
 *
 *  - The idempotency key is bucketed by minute rather than by `sentCount`. A double-click
 *    or a double-submitted form sends once; a firm that genuinely wants to nudge again an
 *    hour later can.
 *  - It does **not** advance the cadence. A manual nudge is the firm stepping in, not the
 *    schedule firing, and consuming a step would silently shorten the sequence the firm
 *    configured.
 *
 * Unlike the scan, this reports failure to the caller — somebody is watching a button.
 */
export async function sendManualReminder(
  deps: ReminderDeps,
  requestId: string,
  actor: { firmId: string; actorId: string },
): Promise<ManualResult> {
  const now = deps.now?.() ?? new Date();

  const found = await findReminderTarget(deps.db, requestId, actor.firmId);
  if (!found) return { ok: false, error: 'Request not found.' };
  if (!found.clientEmail.trim()) {
    return { ok: false, error: 'This client has no email address. Add one and try again.' };
  }

  const outstanding = await outstandingItems(deps.db, requestId);
  if (outstanding.requiredMissing === 0) {
    return {
      ok: false,
      error: 'Everything required is already in — there is nothing to remind them about.',
    };
  }

  const minute = new Date(now).toISOString().slice(0, 16);
  const idempotencyKey = `manual:${requestId}:${minute}`;

  const claimed = await claimReminder(deps.db, {
    requestId,
    scheduleId: found.scheduleId,
    toAddress: found.clientEmail,
    idempotencyKey,
  });
  if (!claimed) {
    return { ok: false, error: 'A reminder for this request went out moments ago.' };
  }

  // A manual nudge always reads as a reminder, never as the original request — the firm
  // is following up, and "here is a new request" would be wrong.
  const email = buildEmail(deps.config, found, outstanding, Math.max(1, found.sentCount));

  try {
    const sent = await deps.mail.send({
      to: found.clientEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey,
      headers: { 'X-Gather-Request': requestId },
    });

    await deps.db.transaction(async (tx) => {
      await recordReminderResult(tx, claimed.id, {
        status: 'sent',
        providerMessageId: sent.providerMessageId,
      });
      await appendAuditEvent(tx, {
        action: 'reminder.sent_manually',
        actorType: 'user',
        actorId: actor.actorId,
        firmId: actor.firmId,
        requestId,
        targetType: 'reminder_log',
        targetId: claimed.id,
        metadata: {
          to: redactEmail(found.clientEmail),
          outstanding: outstanding.labels.length,
          providerMessageId: sent.providerMessageId,
        },
      });
    });

    deps.logger.info('manual reminder sent', {
      requestId,
      driver: sent.driver,
      providerMessageId: sent.providerMessageId,
    });
    return { ok: true, providerMessageId: sent.providerMessageId };
  } catch (error) {
    const message = (error as Error).message;
    await recordReminderResult(deps.db, claimed.id, { status: 'failed', error: message });
    deps.logger.error('manual reminder failed', { requestId, error: message });
    return { ok: false, error: message };
  }
}
