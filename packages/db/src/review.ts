import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { isAnswered, type ResponseValue, type TemplateItem } from '@gather/core';
import { appendAuditEvent } from './audit.js';
import type { Database, DbTransaction } from './client.js';
import { stopSchedule } from './reminders.js';
import { ensureResponse, readItemStates, type FileRow } from './responses.js';
import { client, file, item, request, response, section } from './schema/gather.js';
import { readRequestStructure } from './structure.js';

/**
 * The firm's judgement, item by item.
 *
 * This is the mechanic the whole product turns on. plan.md §2.4 quotes a practitioner on
 * the difference between "the client thinks they have sent everything" and "the firm says
 * it has everything", and the answer is that only the firm can mark an item done. Nothing
 * here infers approval from a file existing.
 *
 * Rejection is the interesting direction. It bumps `response.version`, which is what makes
 * a resubmission a *new* answer rather than an edit of the old one: files carry the version
 * they were uploaded against, so the superseded copy is retained and still attributable —
 * plan.md §4.4's reason for that column.
 */

export type ReviewDecision = 'approved' | 'rejected';

export interface ReviewResult {
  itemId: string;
  status: ReviewDecision;
  version: number;
  /** True when this decision was the one that finished the request. */
  completed: boolean;
  requiredRemaining: number;
}

/** Required items still not approved. Zero is the definition of a complete request. */
export async function requiredNotApproved(
  db: Database | DbTransaction,
  requestId: string,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(item)
    .innerJoin(section, eq(section.id, item.sectionId))
    .leftJoin(response, eq(response.itemId, item.id))
    .where(
      and(
        eq(section.requestId, requestId),
        eq(item.required, true),
        or(isNull(response.id), ne(response.status, 'approved')),
      ),
    );
  return rows[0]?.total ?? 0;
}

interface ReviewActor {
  firmId: string;
  actorId: string;
  ip?: string | null;
  ua?: string | null;
}

/**
 * Approve one item.
 *
 * Deliberately permitted on an item with nothing in it. A firm that has been told on the
 * phone that a client has no rental income should be able to tick it off, and refusing
 * would push them into asking the client to type "n/a" — which is worse for everyone and
 * leaves a less honest record than an approval with the firm's name on it.
 */
export async function approveItem(
  tx: DbTransaction,
  requestId: string,
  itemId: string,
  actor: ReviewActor,
): Promise<ReviewResult> {
  const row = await requireItemOfRequest(tx, requestId, itemId);
  await ensureResponse(tx, itemId);

  const now = new Date();
  const updated = await tx
    .update(response)
    .set({
      status: 'approved',
      // The note described why the *previous* version was sent back. Approving is the end
      // of that conversation, so leaving it would put a stale complaint on a done item.
      rejectNote: null,
      reviewedAt: now,
      reviewedBy: actor.actorId,
      updatedAt: now,
    })
    .where(eq(response.itemId, itemId))
    .returning();
  const saved = updated[0]!;

  await appendAuditEvent(tx, {
    action: 'response.approved',
    actorType: 'user',
    actorId: actor.actorId,
    firmId: actor.firmId,
    requestId,
    targetType: 'response',
    targetId: saved.id,
    metadata: { itemId, label: row.label, version: saved.version },
    ip: actor.ip ?? null,
    ua: actor.ua ?? null,
  });

  const remaining = await requiredNotApproved(tx, requestId);
  const completed = remaining === 0 && (await completeIfFinished(tx, requestId, actor));

  return {
    itemId,
    status: 'approved',
    version: saved.version,
    completed,
    requiredRemaining: remaining,
  };
}

/**
 * Send one item back, with a note the client will read.
 *
 * The note is not optional. "Rejected" with no explanation is how a client ends up sending
 * the same wrong document three times, and the r/taxpros threads in plan.md §2.4 are full
 * of exactly that loop.
 */
export async function rejectItem(
  tx: DbTransaction,
  requestId: string,
  itemId: string,
  note: string,
  actor: ReviewActor,
): Promise<ReviewResult> {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new Error('Say what is wrong with it — the client sees this note and nothing else.');
  }

  const row = await requireItemOfRequest(tx, requestId, itemId);
  await ensureResponse(tx, itemId);

  const now = new Date();
  const updated = await tx
    .update(response)
    .set({
      status: 'rejected',
      rejectNote: trimmed,
      // The bump is what makes the next answer a new version rather than an edit: files
      // already attached keep the version they were uploaded against, so the superseded
      // copy stays retained and attributable.
      version: sql`${response.version} + 1`,
      reviewedAt: now,
      reviewedBy: actor.actorId,
      submittedAt: null,
      updatedAt: now,
    })
    .where(eq(response.itemId, itemId))
    .returning();
  const saved = updated[0]!;

  // The ball is back with the client, so the request is no longer waiting on the firm.
  // This is also what makes it eligible for reminders again.
  await tx
    .update(request)
    .set({ status: 'in_progress', completedAt: null, updatedAt: now })
    .where(and(eq(request.id, requestId), inArray(request.status, ['submitted', 'complete'])));

  await appendAuditEvent(tx, {
    action: 'response.rejected',
    actorType: 'user',
    actorId: actor.actorId,
    firmId: actor.firmId,
    requestId,
    targetType: 'response',
    targetId: saved.id,
    metadata: { itemId, label: row.label, version: saved.version, note: trimmed },
    ip: actor.ip ?? null,
    ua: actor.ua ?? null,
  });

  return {
    itemId,
    status: 'rejected',
    version: saved.version,
    completed: false,
    requiredRemaining: await requiredNotApproved(tx, requestId),
  };
}

/**
 * Mark the request complete, and stop chasing, when the last required item is approved.
 *
 * Both in the same transaction as the approval that caused it. A request that is finished
 * while its reminder schedule is still running would email a client to ask for documents
 * the firm has already accepted.
 */
async function completeIfFinished(
  tx: DbTransaction,
  requestId: string,
  actor: ReviewActor,
): Promise<boolean> {
  const updated = await tx
    .update(request)
    .set({ status: 'complete', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(request.id, requestId), ne(request.status, 'complete')))
    .returning({ id: request.id, title: request.title });

  if (updated.length === 0) return false;

  await stopSchedule(tx, requestId, 'every required item was approved', {
    firmId: actor.firmId,
    actorId: actor.actorId,
    actorType: 'user',
  });

  await appendAuditEvent(tx, {
    action: 'request.completed',
    actorType: 'user',
    actorId: actor.actorId,
    firmId: actor.firmId,
    requestId,
    targetType: 'request',
    targetId: requestId,
    metadata: { title: updated[0]!.title, reason: 'every required item was approved' },
    ip: actor.ip ?? null,
    ua: actor.ua ?? null,
  });

  return true;
}

async function requireItemOfRequest(
  tx: DbTransaction,
  requestId: string,
  itemId: string,
): Promise<{ id: string; label: string }> {
  const rows = await tx
    .select({ id: item.id, label: item.label })
    .from(item)
    .innerJoin(section, eq(section.id, item.sectionId))
    .where(and(eq(item.id, itemId), eq(section.requestId, requestId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error('That item is not part of this request.');
  return row;
}

// ── The zip ──────────────────────────────────────────────────────────────────

export interface DownloadableFile {
  file: FileRow;
  itemLabel: string;
  sectionTitle: string;
  sectionPosition: number;
  itemPosition: number;
  responseStatus: string;
  responseVersion: number;
  /** False for a file superseded by a resubmission. */
  current: boolean;
}

/**
 * Every file in a request, in checklist order, with enough context to name it.
 *
 * Superseded versions are included and flagged rather than filtered out here: the firm's
 * file inventory wants all of them (plan.md §6, 16 CFR 314.4(c)(2)) and the zip wants only
 * the current ones, and one query serving both is one place for the ownership joins to be
 * right.
 */
export async function filesForDownload(
  db: Database | DbTransaction,
  requestId: string,
): Promise<DownloadableFile[]> {
  const rows = await db
    .select({
      file,
      itemLabel: item.label,
      itemPosition: item.position,
      sectionTitle: section.title,
      sectionPosition: section.position,
      responseStatus: response.status,
      responseVersion: response.version,
    })
    .from(file)
    .innerJoin(response, eq(response.id, file.responseId))
    .innerJoin(item, eq(item.id, response.itemId))
    .innerJoin(section, eq(section.id, item.sectionId))
    .where(eq(section.requestId, requestId))
    .orderBy(asc(section.position), asc(item.position), asc(file.uploadedAt), asc(file.id));

  return rows.map((row) => ({
    file: row.file,
    itemLabel: row.itemLabel,
    sectionTitle: row.sectionTitle,
    sectionPosition: row.sectionPosition,
    itemPosition: row.itemPosition,
    responseStatus: row.responseStatus,
    responseVersion: row.responseVersion,
    current: row.file.responseVersion === row.responseVersion,
  }));
}

// ── The dashboard ────────────────────────────────────────────────────────────

export interface RequestSummary {
  id: string;
  title: string;
  status: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  dueAt: Date | null;
  sentAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  totalItems: number;
  approvedItems: number;
  requiredItems: number;
  requiredApproved: number;
  awaitingReview: number;
  /** When the oldest still-unapproved item was first asked for. Drives "oldest outstanding". */
  oldestOutstandingAt: Date | null;
  remindersActive: boolean;
  lastReminderAt: Date | null;
}

export type RequestFilter = 'all' | 'open' | 'needs-review' | 'overdue' | 'complete';

/**
 * Every request a firm has, with the numbers the dashboard shows.
 *
 * One query with aggregates rather than N+1: a firm in January has hundreds of open
 * requests, and a dashboard that issues a query per row is a dashboard nobody opens twice.
 */
export async function listRequestSummaries(
  db: Database | DbTransaction,
  firmId: string,
  filter: RequestFilter = 'all',
  page?: { size: number; offset: number },
): Promise<RequestSummary[]> {
  const counts = db
    .select({
      requestId: section.requestId,
      totalItems: sql<number>`count(*)::int`.as('total_items'),
      approvedItems: sql<number>`count(*) filter (where ${response.status} = 'approved')::int`.as(
        'approved_items',
      ),
      requiredItems: sql<number>`count(*) filter (where ${item.required})::int`.as(
        'required_items',
      ),
      requiredApproved:
        sql<number>`count(*) filter (where ${item.required} and ${response.status} = 'approved')::int`.as(
          'required_approved',
        ),
      awaitingReview: sql<number>`count(*) filter (where ${response.status} = 'submitted')::int`.as(
        'awaiting_review',
      ),
      oldestOutstandingAt:
        sql<Date | null>`min(${response.updatedAt}) filter (where ${response.status} is distinct from 'approved')`.as(
          'oldest_outstanding_at',
        ),
    })
    .from(item)
    .innerJoin(section, eq(section.id, item.sectionId))
    .leftJoin(response, eq(response.itemId, item.id))
    .groupBy(section.requestId)
    .as('counts');

  const reminders = db
    .select({
      requestId: sql<string>`request_id`.as('rl_request_id'),
      lastReminderAt: sql<Date | null>`max(sent_at)`.as('last_reminder_at'),
    })
    .from(sql`reminder_log`)
    .groupBy(sql`request_id`)
    .as('reminders');

  const rows = await db
    .select({
      id: request.id,
      title: request.title,
      status: request.status,
      clientId: client.id,
      clientName: client.name,
      clientEmail: client.email,
      dueAt: request.dueAt,
      sentAt: request.sentAt,
      completedAt: request.completedAt,
      updatedAt: request.updatedAt,
      totalItems: sql<number>`coalesce(${counts.totalItems}, 0)`,
      approvedItems: sql<number>`coalesce(${counts.approvedItems}, 0)`,
      requiredItems: sql<number>`coalesce(${counts.requiredItems}, 0)`,
      requiredApproved: sql<number>`coalesce(${counts.requiredApproved}, 0)`,
      awaitingReview: sql<number>`coalesce(${counts.awaitingReview}, 0)`,
      oldestOutstandingAt: counts.oldestOutstandingAt,
      remindersActive: sql<boolean>`exists (
        select 1 from reminder_schedule rs
         where rs.request_id = ${request.id} and rs.active
      )`,
      lastReminderAt: reminders.lastReminderAt,
    })
    .from(request)
    .innerJoin(client, eq(client.id, request.clientId))
    .leftJoin(counts, eq(counts.requestId, request.id))
    .leftJoin(reminders, eq(reminders.requestId, request.id))
    .where(and(eq(request.firmId, firmId), whereForFilter(filter)))
    .orderBy(desc(request.updatedAt))
    // Bounded when the caller says so. Unbounded is still the default because the audit
    // export and the reminder scan legitimately want every row; a *page* is what the
    // dashboard wants, and it used to render all of them.
    .limit(page?.size ?? Number.MAX_SAFE_INTEGER)
    .offset(page?.offset ?? 0);

  // The two aggregate timestamps come back as strings, not Dates.
  //
  // Drizzle maps a *column* to a Date because it knows the column's type; a `sql<Date>`
  // fragment is an assertion it cannot check, and node-postgres has date parsing switched
  // off so drizzle can do the mapping itself. So `min(...)` and `max(...)` arrive as
  // `'2026-09-05 15:10:41.881+00'` — and every caller that typechecks perfectly against
  // `Date | null` throws on `.getTime()` at runtime.
  //
  // This one took down the whole dashboard the moment any client submitted anything, which
  // is to say: for every real user, on the page they open first.
  return rows.map((row) => ({
    ...row,
    oldestOutstandingAt: toDate(row.oldestOutstandingAt),
    lastReminderAt: toDate(row.lastReminderAt),
  }));
}

/** Whatever the driver handed back, as a Date. */
function toDate(value: Date | string | null): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  // Postgres renders timestamptz as `2026-09-05 15:10:41.881+00`; the space and the
  // two-digit offset are both outside the ISO grammar V8 parses strictly, so they are
  // normalised rather than handed straight to `new Date`.
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function whereForFilter(filter: RequestFilter) {
  switch (filter) {
    case 'open':
      return inArray(request.status, ['draft', 'sent', 'in_progress', 'submitted']);
    case 'needs-review':
      return eq(request.status, 'submitted');
    case 'overdue':
      return and(
        inArray(request.status, ['sent', 'in_progress', 'submitted']),
        sql`${request.dueAt} is not null and ${request.dueAt} < now()`,
      );
    case 'complete':
      return eq(request.status, 'complete');
    default:
      return ne(request.status, 'archived');
  }
}

export interface FirmTotals {
  open: number;
  needsReview: number;
  overdue: number;
  complete: number;
}

/** How many requests a filter would return. Paired with `listRequestSummaries`. */
export async function countRequestSummaries(
  db: Database | DbTransaction,
  firmId: string,
  filter: RequestFilter = 'all',
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(request)
    .where(and(eq(request.firmId, firmId), whereForFilter(filter)));
  return row?.total ?? 0;
}

export async function firmTotals(
  db: Database | DbTransaction,
  firmId: string,
): Promise<FirmTotals> {
  const rows = await db
    .select({
      open: sql<number>`count(*) filter (where ${request.status} in ('draft','sent','in_progress','submitted'))::int`,
      needsReview: sql<number>`count(*) filter (where ${request.status} = 'submitted')::int`,
      overdue: sql<number>`count(*) filter (
        where ${request.status} in ('sent','in_progress','submitted')
          and ${request.dueAt} is not null and ${request.dueAt} < now()
      )::int`,
      complete: sql<number>`count(*) filter (where ${request.status} = 'complete')::int`,
    })
    .from(request)
    .where(eq(request.firmId, firmId));

  return rows[0] ?? { open: 0, needsReview: 0, overdue: 0, complete: 0 };
}

/** How much of a request is done, as the dashboard shows it. */
export function percentComplete(summary: RequestSummary): number {
  if (summary.totalItems === 0) return 0;
  return Math.round((summary.approvedItems / summary.totalItems) * 100);
}

// ── Review queue ─────────────────────────────────────────────────────────────

export interface ReviewItem {
  item: TemplateItem & { id: string };
  sectionTitle: string;
  status: string;
  rejectNote: string | null;
  version: number;
  value: ResponseValue;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  files: { file: FileRow; current: boolean }[];
  answered: boolean;
}

export interface ReviewView {
  sections: { id: string; title: string; items: ReviewItem[] }[];
  total: number;
  approved: number;
  awaitingReview: number;
  requiredRemaining: number;
}

/** The request as the firm reviews it: every item, its state, and every version of its files. */
export async function readReviewView(
  db: Database | DbTransaction,
  requestId: string,
): Promise<ReviewView> {
  const [body, states] = await Promise.all([
    readRequestStructure(db, requestId),
    readItemStates(db, requestId),
  ]);

  let total = 0;
  let approved = 0;
  let awaitingReview = 0;
  let requiredRemaining = 0;

  const sections = body.sections.map((section, index) => ({
    id: section.id ?? `section-${index}`,
    title: section.title,
    items: section.items.map((entry) => {
      const templateItem = entry as TemplateItem & { id: string };
      const state = states.get(templateItem.id);
      const version = state?.version ?? 1;
      const status = state?.status ?? 'pending';

      total += 1;
      if (status === 'approved') approved += 1;
      if (status === 'submitted') awaitingReview += 1;
      if (templateItem.required && status !== 'approved') requiredRemaining += 1;

      return {
        item: templateItem,
        sectionTitle: section.title,
        status,
        rejectNote: state?.rejectNote ?? null,
        version,
        value: (state?.value ?? null) as ResponseValue,
        submittedAt: state?.submittedAt ?? null,
        reviewedAt: null,
        files: (state?.files ?? []).map((row) => ({
          file: row,
          current: row.responseVersion === version,
        })),
        answered: isAnswered(
          templateItem,
          (state?.value ?? null) as ResponseValue,
          state?.files.length ?? 0,
        ),
      } satisfies ReviewItem;
    }),
  }));

  return { sections, total, approved, awaitingReview, requiredRemaining };
}

/** Used by the dashboard's empty state to tell "no requests" from "no matching requests". */
export async function countRequests(db: Database | DbTransaction, firmId: string): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(request)
    .where(and(eq(request.firmId, firmId), ne(request.status, 'archived')));
  return rows[0]?.total ?? 0;
}
