import { describeCadence, env, nextRunAt, parseCadence, type Cadence } from '@gather/core';
import {
  appendAuditEvent,
  findReminderTarget,
  findSchedule,
  getDb,
  listReminderLog,
  outstandingItems,
  stopSchedule,
  upsertSchedule,
  type ReminderLogRow,
} from '@gather/db';
import { getMail, mailConfigured } from '@gather/mail';
import { sendManualReminder } from '@gather/reminders';
import type { Actor } from './actor';
import { logger } from './logger';

/**
 * The firm's side of reminders.
 *
 * Everything here is firm-scoped through `findReminderTarget`, so a request id belonging to
 * another firm resolves to nothing rather than to somebody else's client's email address.
 * Sending itself lives in @gather/reminders, shared with the worker, so a manual nudge and
 * a scheduled one take exactly the same path through the same send-once guard.
 */

export interface ScheduleView {
  cadence: Cadence;
  description: string;
  active: boolean;
  nextRunAt: string | null;
  sentCount: number;
}

export interface ReminderLogView {
  id: string;
  to: string;
  status: string;
  error: string | null;
  providerMessageId: string | null;
  sentAt: string;
}

export interface RemindersView {
  /** `false` when MAIL_DRIVER=none — the UI says so instead of offering a dead button. */
  mailConfigured: boolean;
  schedule: ScheduleView | null;
  log: ReminderLogView[];
  /** What the next reminder would list, so a firm can see it before a client does. */
  outstanding: string[];
  requiredMissing: number;
}

function toLogView(row: ReminderLogRow): ReminderLogView {
  return {
    id: row.id,
    to: row.toAddress,
    status: row.status,
    error: row.error,
    providerMessageId: row.providerMessageId,
    sentAt: row.sentAt.toISOString(),
  };
}

export async function readRemindersView(requestId: string): Promise<RemindersView> {
  const db = getDb();
  const [schedule, log, outstanding] = await Promise.all([
    findSchedule(db, requestId),
    listReminderLog(db, requestId),
    outstandingItems(db, requestId),
  ]);

  return {
    mailConfigured: mailConfigured(),
    schedule: schedule
      ? {
          cadence: parseCadence(schedule.cadence),
          description: describeCadence(parseCadence(schedule.cadence)),
          active: schedule.active,
          nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
          sentCount: schedule.sentCount,
        }
      : null,
    log: log.map(toLogView),
    outstanding: outstanding.labels,
    requiredMissing: outstanding.requiredMissing,
  };
}

/**
 * Save a cadence, and work out when the first reminder should go.
 *
 * The `nextRunAt` is computed here rather than in the worker so that the firm sees the
 * answer immediately — "next reminder Thursday at 09:00" is the only way to tell whether
 * a schedule does what was meant, and finding out three days later is too late.
 */
export async function saveSchedule(
  actor: Actor,
  requestId: string,
  cadence: Cadence,
  active: boolean,
): Promise<{ nextRunAt: Date | null }> {
  const target = await findReminderTarget(getDb(), requestId, actor.firmId);
  if (!target) throw new Error('Request not found.');

  const startedAt = target.sentAt ?? new Date();
  const next = active
    ? nextRunAt(cadence, { startedAt, lastSentAt: null, sentCount: target.sentCount }, new Date())
    : null;

  await getDb().transaction(async (tx) => {
    await upsertSchedule(tx, { requestId, cadence, nextRunAt: next, active });
    await appendAuditEvent(tx, {
      action: active ? 'reminder.schedule_set' : 'reminder.schedule_paused',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      requestId,
      targetType: 'reminder_schedule',
      targetId: requestId,
      metadata: {
        cadence: describeCadence(cadence),
        nextRunAt: next?.toISOString() ?? null,
      },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });
  });

  return { nextRunAt: next };
}

export async function sendReminderNow(
  actor: Actor,
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!mailConfigured()) {
    return {
      ok: false,
      error:
        'No email is configured on this Gather. Set MAIL_DRIVER in your .env and restart to ' +
        'turn reminders on.',
    };
  }

  const result = await sendManualReminder(
    { db: getDb(), mail: getMail(), logger, config: env() },
    requestId,
    { firmId: actor.firmId, actorId: actor.actorId },
  );

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Stop chasing because the work is done.
 *
 * Called when the firm marks a request complete and when the client sends it back. Silent
 * if there was no active schedule — a request nobody set reminders on completing is not an
 * event worth a row in an append-only log.
 */
export async function stopRemindersFor(
  requestId: string,
  reason: string,
  context: { firmId: string; actorId?: string | null; actorType?: 'user' | 'client' | 'system' },
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await stopSchedule(tx, requestId, reason, context);
  });
}
