import { sql } from 'drizzle-orm';
import { effectivePlan, type Plan } from '@gather/core';
import type { Database, DbTransaction } from './client.js';

/**
 * The platform operator's view.
 *
 * **This is the only module in Gather that reads across firms.** Everything else takes a
 * `firmId` and is scoped by it, which is what makes tenancy isolation checkable rather than
 * hoped for: if a query here is the only one without a firm filter, then a bug anywhere else
 * is a missing filter you can grep for. Callers must be platform admins — the check lives in
 * `apps/web/src/lib/admin.ts`, because who operates the install is an app-level fact.
 *
 * It is also read-only. Support wanting to "just fix" one customer's data is how a hosted
 * tier ends up with an audit trail nobody can trust, and this product sells the audit trail.
 * The operator can see, and can bill; changing a firm's documents needs somebody in the firm.
 */

type Db = Database | DbTransaction;

export interface AdminFirmRow {
  id: string;
  name: string;
  createdAt: Date;
  plan: Plan;
  effectivePlan: Plan;
  status: string;
  members: number;
  clients: number;
  requests: number;
  openRequests: number;
  files: number;
  storageBytes: number;
  /** The most recent audit event of any kind, i.e. when this firm was last really used. */
  lastActivityAt: Date | null;
}

/**
 * Shaped as Postgres returns it — which is text, all of it.
 *
 * `db.execute` hands back what the driver parsed for a raw query, and drizzle turns off
 * node-postgres's date parsing so it can apply its own column types. A raw query has no
 * column types, so a timestamp arrives as `'2026-09-05 13:38:11.352+00'` and any code that
 * calls `.getTime()` on it throws at runtime having typechecked perfectly. So the timestamps
 * are selected as epoch seconds and converted here, deliberately, in one place.
 *
 * Counts are text for a different reason: `count(*)` is bigint, and a bigint that arrives as
 * a JavaScript number is a silent precision bug waiting for a big enough install.
 */
interface RawFirmRow extends Record<string, unknown> {
  id: string;
  name: string;
  created_at: string;
  plan: Plan | null;
  status: string | null;
  members: string;
  clients: string;
  requests: string;
  open_requests: string;
  files: string;
  storage_bytes: string;
  last_activity_at: string | null;
}

/** Epoch seconds (possibly fractional, possibly null) as Postgres rendered them. */
function fromEpoch(value: string | null): Date | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

/**
 * Every firm on this install, with what it costs us and how much it is used.
 *
 * One query with correlated sub-selects rather than N+1 across firms: an operator page that
 * gets slower with every customer is a page that stops being opened.
 */
export async function countFirms(db: Db): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(
    sql`select count(*)::text as total from firm`,
  );
  return Number(rows[0]?.total ?? 0);
}

export async function listFirms(
  db: Db,
  page: { size: number; offset: number } = { size: 200, offset: 0 },
): Promise<AdminFirmRow[]> {
  const { rows } = await db.execute<RawFirmRow>(sql`
    select
      f.id,
      f.name,
      extract(epoch from f.created_at)::text as created_at,
      s.plan,
      s.status,
      (select count(*) from firm_user fu where fu.firm_id = f.id)::text as members,
      (select count(*) from client c where c.firm_id = f.id)::text as clients,
      (select count(*) from request r where r.firm_id = f.id)::text as requests,
      (select count(*) from request r
        where r.firm_id = f.id and r.status in ('sent', 'in_progress'))::text as open_requests,
      (select count(*)
         from file fi
         join response rs on rs.id = fi.response_id
         join item i on i.id = rs.item_id
         join section sec on sec.id = i.section_id
         join request r on r.id = sec.request_id
        where r.firm_id = f.id and fi.purged_at is null)::text as files,
      (select coalesce(sum(fi.size), 0)
         from file fi
         join response rs on rs.id = fi.response_id
         join item i on i.id = rs.item_id
         join section sec on sec.id = i.section_id
         join request r on r.id = sec.request_id
        where r.firm_id = f.id and fi.purged_at is null)::text as storage_bytes,
      (select extract(epoch from max(a.created_at))::text
         from audit_event a where a.firm_id = f.id) as last_activity_at
    from firm f
    left join subscription s on s.firm_id = f.id
    order by f.created_at desc
    limit ${page.size} offset ${page.offset}
  `);

  return rows.map((row: RawFirmRow) => {
    const plan = row.plan ?? 'self_hosted';
    const status = row.status ?? 'none';
    return {
      id: row.id,
      name: row.name,
      createdAt: fromEpoch(row.created_at) ?? new Date(0),
      plan,
      effectivePlan: effectivePlan(plan, status as never),
      status,
      members: Number(row.members),
      clients: Number(row.clients),
      requests: Number(row.requests),
      openRequests: Number(row.open_requests),
      files: Number(row.files),
      storageBytes: Number(row.storage_bytes),
      lastActivityAt: fromEpoch(row.last_activity_at),
    };
  });
}

export interface PlatformTotals {
  firms: number;
  users: number;
  requests: number;
  files: number;
  storageBytes: number;
  /** Firms with a subscription in a state that is actually paying us. */
  paying: number;
  /** Firms whose last payment failed. The queue worth working through. */
  pastDue: number;
  /** Reminders that came back undeliverable in the last 7 days. Sending-reputation canary. */
  bouncesLast7Days: number;
}

export async function platformTotals(db: Db): Promise<PlatformTotals> {
  const { rows } = await db.execute<Record<string, string>>(sql`
    select
      (select count(*) from firm)::text as firms,
      (select count(*) from "user")::text as users,
      (select count(*) from request)::text as requests,
      (select count(*) from file where purged_at is null)::text as files,
      (select coalesce(sum(size), 0) from file where purged_at is null)::text as storage_bytes,
      (select count(*) from subscription
        where status in ('active', 'trialing'))::text as paying,
      (select count(*) from subscription where status = 'past_due')::text as past_due,
      (select count(*) from reminder_log
        where status = 'bounced'
          and sent_at > now() - interval '7 days')::text as bounces
  `);

  const row = rows[0] ?? {};
  const num = (key: string) => Number(row[key] ?? 0);

  return {
    firms: num('firms'),
    users: num('users'),
    requests: num('requests'),
    files: num('files'),
    storageBytes: num('storage_bytes'),
    paying: num('paying'),
    pastDue: num('past_due'),
    bouncesLast7Days: num('bounces'),
  };
}
