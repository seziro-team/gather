import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { env } from '@gather/core';
import { getDb } from '@gather/db';

/**
 * Prometheus metrics.
 *
 * **Off unless `GATHER_METRICS_TOKEN` is set**, and a bearer token is required when it is.
 * Not because the numbers are secret in themselves, but because "how many clients does
 * this firm have, and how many documents are they holding" is business intelligence about
 * somebody else's practice, and an unauthenticated endpoint on the public internet is how
 * it leaks. Off by default is the right default for a self-hosted install that will never
 * scrape anything.
 *
 * Deliberately no per-request histograms: that needs middleware on every response and an
 * in-process registry, which on a serverful-of-replicas deployment gives you numbers that
 * are wrong in a confusing way. These are all cheap aggregates over state, which are the
 * ones an operator actually alerts on — is the queue backing up, are reminders bouncing,
 * is storage growing, has the audit chain stopped advancing.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Metric {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  value: number;
}

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
function sameToken(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function render(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    lines.push(`${metric.name} ${metric.value}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function GET(request: Request): Promise<Response> {
  const token = env().GATHER_METRICS_TOKEN;
  // 404 rather than 401: an install that does not export metrics should not advertise that
  // it could.
  if (!token) return new Response('Not found', { status: 404 });

  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!sameToken(offered, token)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer' },
    });
  }

  const db = getDb();

  // One round trip. A scrape every fifteen seconds that costs eight queries is a scrape
  // that eventually shows up as database load in somebody's incident review.
  const { rows } = await db.execute<Record<string, string>>(sql`
    select
      (select count(*) from firm)::text                                   as firms,
      (select count(*) from "user")::text                                 as users,
      (select count(*) from client where archived_at is null)::text       as clients,
      (select count(*) from request)::text                                as requests,
      (select count(*) from request
        where status in ('sent','in_progress'))::text                     as requests_open,
      (select count(*) from request where status = 'submitted')::text     as requests_awaiting_review,
      (select count(*) from request
        where status in ('sent','in_progress','submitted')
          and due_at is not null and due_at < now())::text                as requests_overdue,
      (select count(*) from file where purged_at is null)::text           as files,
      (select coalesce(sum(size),0) from file where purged_at is null)::text as storage_bytes,
      (select count(*) from file where scan_status = 'infected')::text    as files_infected,
      (select count(*) from file where scan_status = 'pending')::text     as files_scan_pending,
      (select count(*) from reminder_schedule where active)::text         as reminder_schedules_active,
      (select count(*) from reminder_schedule
        where active and next_run_at < now())::text                       as reminders_due,
      (select count(*) from reminder_log
        where status = 'bounced' and sent_at > now() - interval '24 hours')::text as reminders_bounced_24h,
      (select count(*) from reminder_log
        where status = 'sent' and sent_at > now() - interval '24 hours')::text    as reminders_sent_24h,
      (select coalesce(max(last_id), 0) from audit_head)::text            as audit_last_id,
      (select count(*) from access_token
        where revoked_at is null and expires_at > now())::text            as portal_links_live
  `);

  const row = rows[0] ?? {};
  const value = (key: string) => Number(row[key] ?? 0);

  const metrics: Metric[] = [
    { name: 'gather_firms', help: 'Firms on this install.', type: 'gauge', value: value('firms') },
    { name: 'gather_users', help: 'User accounts.', type: 'gauge', value: value('users') },
    {
      name: 'gather_clients',
      help: 'Clients, excluding archived.',
      type: 'gauge',
      value: value('clients'),
    },
    {
      name: 'gather_requests',
      help: 'Document requests, all statuses.',
      type: 'gauge',
      value: value('requests'),
    },
    {
      name: 'gather_requests_open',
      help: 'Requests sent to a client and not yet returned.',
      type: 'gauge',
      value: value('requests_open'),
    },
    {
      name: 'gather_requests_awaiting_review',
      help: 'Requests a client has returned that nobody has reviewed. The work queue.',
      type: 'gauge',
      value: value('requests_awaiting_review'),
    },
    {
      name: 'gather_requests_overdue',
      help: 'Open requests past their due date.',
      type: 'gauge',
      value: value('requests_overdue'),
    },
    {
      name: 'gather_files',
      help: 'Stored files, excluding purged.',
      type: 'gauge',
      value: value('files'),
    },
    {
      name: 'gather_storage_bytes',
      help: 'Bytes of client documents held, excluding purged.',
      type: 'gauge',
      value: value('storage_bytes'),
    },
    {
      name: 'gather_files_infected',
      help: 'Files the scanner quarantined. Should be zero; alert if it moves.',
      type: 'gauge',
      value: value('files_infected'),
    },
    {
      name: 'gather_files_scan_pending',
      help: 'Files awaiting a scan verdict. A rising number means clamd is not keeping up.',
      type: 'gauge',
      value: value('files_scan_pending'),
    },
    {
      name: 'gather_reminder_schedules_active',
      help: 'Reminder schedules currently chasing somebody.',
      type: 'gauge',
      value: value('reminder_schedules_active'),
    },
    {
      name: 'gather_reminders_due',
      help: 'Schedules past their next run time. Above zero for long means the worker is stopped.',
      type: 'gauge',
      value: value('reminders_due'),
    },
    {
      name: 'gather_reminders_sent_24h',
      help: 'Reminders sent in the last 24 hours.',
      type: 'gauge',
      value: value('reminders_sent_24h'),
    },
    {
      name: 'gather_reminders_bounced_24h',
      help: 'Reminders that bounced in the last 24 hours. Sending-reputation canary.',
      type: 'gauge',
      value: value('reminders_bounced_24h'),
    },
    {
      name: 'gather_audit_last_id',
      help: 'Head of the audit chain. Monotonic; if it stops moving, nothing is being recorded.',
      type: 'counter',
      value: value('audit_last_id'),
    },
    {
      name: 'gather_portal_links_live',
      help: 'Client portal links that are neither expired nor revoked.',
      type: 'gauge',
      value: value('portal_links_live'),
    },
  ];

  return new Response(render(metrics), {
    status: 200,
    headers: {
      // The version Prometheus and OpenMetrics scrapers both accept.
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
