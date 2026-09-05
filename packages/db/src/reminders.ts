import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { isAnswered, type Cadence, type ResponseValue, type TemplateItem } from '@gather/core';
import { appendAuditEvent } from './audit.js';
import type { Database, DbTransaction } from './client.js';
import { readItemStates } from './responses.js';
import { client, firm, reminderLog, reminderSchedule, request } from './schema/gather.js';
import { readRequestStructure } from './structure.js';

type Db = Database | DbTransaction;

/**
 * Reading and writing reminder schedules.
 *
 * The rule the whole file exists to hold up: **a reminder is sent at most once**. Every
 * other property — cadence, quiet hours, stop-on-complete — is a convenience on top. A
 * client who gets the same nag twice concludes the firm is not paying attention, and a
 * client who gets it six times because a worker crash-looped unsubscribes.
 */

export type ReminderScheduleRow = typeof reminderSchedule.$inferSelect;
export type ReminderLogRow = typeof reminderLog.$inferSelect;

/**
 * Everything composing a reminder needs, in one query.
 *
 * The email is branded from the request's frozen `brandSnapshot` when there is one and the
 * firm's current branding otherwise, so both are selected here rather than fetched later.
 */
export interface ReminderTarget {
  requestId: string;
  firmId: string;
  requestTitle: string;
  requestStatus: string;
  dueAt: Date | null;
  sentAt: Date | null;
  brandSnapshot: unknown;
  clientName: string;
  /** `client.email` is NOT NULL, so this is always a string — but not always a usable one. */
  clientEmail: string;
  firmName: string;
  firmColor: string;
  firmLogoUrl: string | null;
  firmTimezone: string;
  /** `null` when the request has no schedule — a manual nudge does not need one. */
  scheduleId: string | null;
  sentCount: number;
}

export interface DueReminder extends ReminderTarget {
  schedule: ReminderScheduleRow;
}

const TARGET_COLUMNS = {
  requestId: request.id,
  firmId: request.firmId,
  requestTitle: request.title,
  requestStatus: request.status,
  dueAt: request.dueAt,
  sentAt: request.sentAt,
  brandSnapshot: request.brandSnapshot,
  clientName: client.name,
  clientEmail: client.email,
  firmName: firm.name,
  firmColor: firm.brandColor,
  firmLogoUrl: firm.logoUrl,
  firmTimezone: firm.timezone,
} as const;

/**
 * Schedules that have come due.
 *
 * `FOR UPDATE SKIP LOCKED` on the schedule rows means two workers can run this at the same
 * moment and never pick up the same schedule — the second simply does not see rows the
 * first is holding. That is the cheap half of the send-once guarantee; the durable half is
 * the unique index in `claimReminder`, which survives a process being killed rather than
 * merely finishing.
 */
export async function claimDueSchedules(
  db: Database,
  now: Date,
  limit: number,
): Promise<DueReminder[]> {
  const rows = await db
    .select({
      ...TARGET_COLUMNS,
      schedule: reminderSchedule,
      scheduleId: reminderSchedule.id,
      sentCount: reminderSchedule.sentCount,
    })
    .from(reminderSchedule)
    .innerJoin(request, eq(request.id, reminderSchedule.requestId))
    .innerJoin(client, eq(client.id, request.clientId))
    .innerJoin(firm, eq(firm.id, request.firmId))
    .where(
      and(
        eq(reminderSchedule.active, true),
        isNotNull(reminderSchedule.nextRunAt),
        lte(reminderSchedule.nextRunAt, now),
        // A request nobody has opened yet still gets chased; one that is finished,
        // archived or back with the firm does not.
        inArray(request.status, ['sent', 'in_progress']),
      ),
    )
    .orderBy(asc(reminderSchedule.nextRunAt))
    .limit(limit)
    .for('update', { of: reminderSchedule, skipLocked: true });

  return rows;
}

/**
 * One request's reminder context, scoped to the firm that owns it.
 *
 * Firm-scoped in the query rather than checked afterwards — the same rule the rest of
 * Gather follows, so a request id from another firm resolves to nothing rather than to
 * somebody else's client's email address.
 *
 * The schedule is optional here: a firm can send a manual nudge on a request it never set
 * a cadence for, which is exactly what somebody does the first time they try the feature.
 */
export async function findReminderTarget(
  db: Db,
  requestId: string,
  firmId: string,
): Promise<ReminderTarget | null> {
  const rows = await db
    .select({
      ...TARGET_COLUMNS,
      scheduleId: reminderSchedule.id,
      sentCount: reminderSchedule.sentCount,
    })
    .from(request)
    .innerJoin(client, eq(client.id, request.clientId))
    .innerJoin(firm, eq(firm.id, request.firmId))
    .leftJoin(reminderSchedule, eq(reminderSchedule.requestId, request.id))
    .where(and(eq(request.id, requestId), eq(request.firmId, firmId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, sentCount: row.sentCount ?? 0 };
}

export interface ClaimInput {
  requestId: string;
  scheduleId: string | null;
  toAddress: string;
  idempotencyKey: string;
}

/**
 * Reserve the right to send one reminder.
 *
 * Returns the log row on success, or `null` if this exact reminder has already been
 * claimed — which is what a restarted worker, a duplicated job or a double-clicked button
 * looks like from here. The caller sends only if it gets a row back.
 */
export async function claimReminder(db: Db, input: ClaimInput): Promise<ReminderLogRow | null> {
  const [row] = await db
    .insert(reminderLog)
    .values({
      requestId: input.requestId,
      scheduleId: input.scheduleId,
      toAddress: input.toAddress,
      idempotencyKey: input.idempotencyKey,
      status: 'queued',
    })
    .onConflictDoNothing({ target: reminderLog.idempotencyKey })
    .returning();

  return row ?? null;
}

export async function recordReminderResult(
  db: Db,
  logId: string,
  result: { status: string; providerMessageId?: string | null; error?: string | null },
): Promise<void> {
  await db
    .update(reminderLog)
    .set({
      status: result.status,
      providerMessageId: result.providerMessageId ?? null,
      error: result.error ?? null,
      sentAt: new Date(),
    })
    .where(eq(reminderLog.id, logId));
}

/** Move a schedule on after a successful send. */
export async function advanceSchedule(
  db: Db,
  scheduleId: string,
  nextRunAt: Date | null,
): Promise<void> {
  await db
    .update(reminderSchedule)
    .set({
      sentCount: sql`${reminderSchedule.sentCount} + 1`,
      nextRunAt,
      // A schedule with nowhere left to go is finished, not merely idle. Saying so is what
      // makes "reminders have stopped" visible in the UI rather than inferred from a null.
      active: nextRunAt !== null,
      updatedAt: new Date(),
    })
    .where(eq(reminderSchedule.id, scheduleId));
}

/**
 * Push a schedule out after a failure that is worth retrying.
 *
 * Deliberately does **not** touch `sentCount`: nothing was sent, so the next attempt must
 * reuse the same idempotency key and stay the same reminder rather than becoming the next
 * one in the sequence.
 */
export async function deferSchedule(db: Db, scheduleId: string, nextRunAt: Date): Promise<void> {
  await db
    .update(reminderSchedule)
    .set({ nextRunAt, updatedAt: new Date() })
    .where(eq(reminderSchedule.id, scheduleId));
}

export interface UpsertScheduleInput {
  requestId: string;
  cadence: Cadence;
  nextRunAt: Date | null;
  active: boolean;
}

/** One schedule per request; editing replaces the cadence in place. */
export async function upsertSchedule(
  db: Db,
  input: UpsertScheduleInput,
): Promise<ReminderScheduleRow> {
  const existing = await db
    .select()
    .from(reminderSchedule)
    .where(eq(reminderSchedule.requestId, input.requestId))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(reminderSchedule)
      .set({
        cadence: input.cadence,
        nextRunAt: input.nextRunAt,
        active: input.active,
        maxCount: input.cadence.maxCount ?? null,
        updatedAt: new Date(),
      })
      .where(eq(reminderSchedule.id, existing[0].id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(reminderSchedule)
    .values({
      requestId: input.requestId,
      cadence: input.cadence,
      nextRunAt: input.nextRunAt,
      active: input.active,
      maxCount: input.cadence.maxCount ?? null,
    })
    .returning();
  return created!;
}

export async function findSchedule(db: Db, requestId: string): Promise<ReminderScheduleRow | null> {
  const rows = await db
    .select()
    .from(reminderSchedule)
    .where(eq(reminderSchedule.requestId, requestId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Stop chasing, and say why in the audit log.
 *
 * Called when a request reaches a state where more email would be wrong: the client has
 * sent everything back, the firm marked it complete, or it was archived. Returns whether
 * anything was actually stopped, so a caller does not audit a no-op.
 */
export async function stopSchedule(
  tx: DbTransaction,
  requestId: string,
  reason: string,
  context: { firmId: string; actorId?: string | null; actorType?: 'user' | 'client' | 'system' },
): Promise<boolean> {
  const [stopped] = await tx
    .update(reminderSchedule)
    .set({ active: false, nextRunAt: null, updatedAt: new Date() })
    .where(and(eq(reminderSchedule.requestId, requestId), eq(reminderSchedule.active, true)))
    .returning({ id: reminderSchedule.id });

  // Already stopped, or there was never a schedule. Either way nothing happened, and an
  // audit event saying otherwise would be a lie in an append-only log.
  if (!stopped) return false;

  await appendAuditEvent(tx, {
    action: 'reminder.stopped',
    actorType: context.actorType ?? 'system',
    actorId: context.actorId ?? null,
    firmId: context.firmId,
    requestId,
    targetType: 'reminder_schedule',
    targetId: stopped.id,
    metadata: { reason },
  });

  return true;
}

export async function listReminderLog(db: Db, requestId: string): Promise<ReminderLogRow[]> {
  return db
    .select()
    .from(reminderLog)
    .where(eq(reminderLog.requestId, requestId))
    .orderBy(desc(reminderLog.sentAt));
}

/**
 * Apply a delivery outcome that arrived by webhook.
 *
 * Matched on the provider's message id, because that is the only thing the webhook and the
 * log row have in common. Returns the request the reminder belonged to, so the caller can
 * scope an audit event to a firm without a second query.
 */
export async function applyDeliveryEvent(
  db: Db,
  providerMessageId: string,
  status: string,
  error: string | null,
): Promise<{ id: string; requestId: string; previous: string } | null> {
  const rows = await db
    .select({ id: reminderLog.id, requestId: reminderLog.requestId, status: reminderLog.status })
    .from(reminderLog)
    .where(eq(reminderLog.providerMessageId, providerMessageId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db.update(reminderLog).set({ status, error }).where(eq(reminderLog.id, row.id));

  return { id: row.id, requestId: row.requestId, previous: row.status };
}

export interface OutstandingSummary {
  /** Labels of items still not answered, in checklist order. */
  labels: string[];
  total: number;
  /** Required items still missing — the number that decides whether a request can close. */
  requiredMissing: number;
}

/**
 * What a client still owes, phrased the way the email says it.
 *
 * Shared between the worker (which writes the reminder) and the request page (which shows
 * what the next one will say), so a firm previewing a reminder sees the list the client
 * will get rather than a second implementation of the same idea.
 */
export async function outstandingItems(db: Db, requestId: string): Promise<OutstandingSummary> {
  const [body, states] = await Promise.all([
    readRequestStructure(db, requestId),
    readItemStates(db, requestId),
  ]);

  const labels: string[] = [];
  let total = 0;
  let requiredMissing = 0;

  for (const section of body.sections) {
    for (const entry of section.items) {
      const item = entry as TemplateItem & { id: string };
      const state = states.get(item.id);
      total += 1;

      // An item the firm has already approved is done regardless of what is in it, and a
      // rejected one is outstanding again even though it holds a file.
      const answered =
        state?.status === 'approved' ||
        (state?.status !== 'rejected' &&
          // `value` is jsonb, so the column type is `unknown`; it was written through
          // `parseResponseValue` and is one of the shapes `isAnswered` handles.
          isAnswered(item, (state?.value ?? null) as ResponseValue, state?.files.length ?? 0));

      if (!answered) {
        labels.push(item.label);
        if (item.required) requiredMissing += 1;
      }
    }
  }

  return { labels, total, requiredMissing };
}
