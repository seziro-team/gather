import Link from 'next/link';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  auditEvent,
  client,
  countRequests,
  firmTotals,
  getDb,
  countRequestSummaries,
  listRequestSummaries,
  percentComplete,
  type RequestFilter,
  type RequestSummary,
} from '@gather/db';
import { paginate, parsePage } from '@gather/core';
import { Pager } from '@/components/pager';
import { Alert, Badge, Card, linkButton } from '@/components/ui';
import { ACTION_LABELS } from '@/lib/audit-labels';
import { formatDueDate } from '@/lib/format';
import { requireReadyUser } from '@/lib/session';

/**
 * What the firm is waiting on.
 *
 * The one question this page answers is "what needs me?", so the review queue is first,
 * overdue is second, and everything else is a filter away. A dashboard that opens on a
 * list of counts is a dashboard people check once a week; this one opens on work.
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard · Gather' };

const FILTERS: { key: RequestFilter; label: string }[] = [
  { key: 'needs-review', label: 'Waiting on you' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'open', label: 'Open' },
  { key: 'complete', label: 'Complete' },
  { key: 'all', label: 'All' },
];

const STATUS_TONE: Record<string, 'green' | 'amber' | 'brand' | 'neutral'> = {
  draft: 'neutral',
  sent: 'brand',
  in_progress: 'brand',
  submitted: 'amber',
  complete: 'green',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent — not opened',
  in_progress: 'With the client',
  submitted: 'Waiting on you',
  complete: 'Complete',
  archived: 'Archived',
};

function isFilter(value: string | undefined): value is RequestFilter {
  return (
    value === 'all' ||
    value === 'open' ||
    value === 'needs-review' ||
    value === 'overdue' ||
    value === 'complete'
  );
}

/** "18 days" — how long the oldest unanswered item has been waiting. */
function waitingFor(summary: RequestSummary, now: Date): string | null {
  const since = summary.oldestOutstandingAt ?? summary.sentAt;
  if (!since || summary.status === 'complete' || summary.status === 'draft') return null;
  const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const { membership } = await requireReadyUser();
  const db = getDb();
  const firmId = membership.firm.id;

  const params = await searchParams;
  // Default to the queue rather than to everything: the firm opens this to find work.
  const filter: RequestFilter = isFilter(params.filter) ? params.filter : 'needs-review';
  const page = parsePage(params.page);

  const [clientCount, totalRequests, totals, summaries, filtered, recent] = await Promise.all([
    db
      .select({ total: count() })
      .from(client)
      .where(and(eq(client.firmId, firmId), isNull(client.archivedAt))),
    countRequests(db, firmId),
    firmTotals(db, firmId),
    listRequestSummaries(db, firmId, filter, page),
    countRequestSummaries(db, firmId, filter),
    db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.firmId, firmId))
      .orderBy(desc(auditEvent.id))
      .limit(10),
  ]);

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: membership.firm.timezone,
  });

  const counts: Record<RequestFilter, number> = {
    'needs-review': totals.needsReview,
    overdue: totals.overdue,
    open: totals.open,
    complete: totals.complete,
    all: totalRequests,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{membership.firm.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {clientCount[0]?.total ?? 0} client{(clientCount[0]?.total ?? 0) === 1 ? '' : 's'} ·{' '}
            {totalRequests} request{totalRequests === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/requests/new" className={linkButton()}>
            New request
          </Link>
          <a href="/audit" className={linkButton('secondary')} data-testid="export-audit">
            Export audit trail
          </a>
        </div>
      </div>

      {totals.needsReview > 0 ? (
        <Alert tone="warning" title={`${totals.needsReview} waiting for your review`}>
          A client has sent everything they were asked for. Nothing is complete until you say so,
          item by item.
        </Alert>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label="Filter requests">
        {FILTERS.map((entry) => {
          const active = entry.key === filter;
          return (
            <Link
              key={entry.key}
              href={`/dashboard?filter=${entry.key}`}
              data-testid={`filter-${entry.key}`}
              aria-current={active ? 'page' : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
                active
                  ? 'bg-brand-700 ring-brand-700 text-white'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {entry.label}
              <span className={active ? 'ml-1.5 opacity-80' : 'ml-1.5 text-slate-400'}>
                {counts[entry.key]}
              </span>
            </Link>
          );
        })}
      </nav>

      <Card>
        {summaries.length === 0 ? (
          <p className="text-sm text-slate-600">
            {totalRequests === 0
              ? 'No requests yet. Create one and send the link to a client — they need no account.'
              : 'Nothing here right now.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="request-list">
            {summaries.map((summary) => {
              const percent = percentComplete(summary);
              const waiting = waitingFor(summary, now);
              const overdue =
                summary.dueAt !== null && summary.dueAt < now && summary.status !== 'complete';

              return (
                <li
                  key={summary.id}
                  data-testid="request-row"
                  data-request-id={summary.id}
                  data-status={summary.status}
                  className="py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={`/requests/${summary.id}`}
                      className="text-brand-700 text-sm font-medium hover:underline"
                    >
                      {summary.title}
                    </Link>
                    <span className="text-sm text-slate-600">{summary.clientName}</span>
                    <Badge tone={STATUS_TONE[summary.status] ?? 'neutral'}>
                      {STATUS_LABEL[summary.status] ?? summary.status}
                    </Badge>
                    {summary.awaitingReview > 0 ? (
                      <Badge tone="amber">{summary.awaitingReview} to review</Badge>
                    ) : null}
                    {overdue && summary.dueAt ? (
                      <Badge tone="red">Due {formatDueDate(summary.dueAt)}</Badge>
                    ) : null}
                    {summary.remindersActive ? <Badge tone="brand">Reminding</Badge> : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${summary.title} progress`}
                      className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-200"
                    >
                      <div
                        className={
                          percent === 100 ? 'h-full bg-emerald-500' : 'bg-brand-600 h-full'
                        }
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-600">
                      {summary.approvedItems} of {summary.totalItems} approved
                    </span>
                    {waiting ? (
                      <span className="text-xs text-slate-500">· outstanding {waiting}</span>
                    ) : null}
                    {summary.lastReminderAt ? (
                      <span className="text-xs text-slate-500">
                        · last reminded {formatter.format(summary.lastReminderAt)}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Pager
          page={paginate(summaries, filtered, page)}
          basePath="/dashboard"
          unit="request"
          params={{ filter }}
        />
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Recent activity</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className="font-mono text-xs text-slate-400">#{event.id}</span>
                <span className="text-sm font-medium text-slate-900">
                  {ACTION_LABELS[event.action] ?? event.action}
                </span>
                <span className="text-sm text-slate-500">{formatter.format(event.createdAt)}</span>
                <span
                  className="ml-auto font-mono text-xs text-slate-300"
                  title={`sha256 ${event.hash}`}
                >
                  {event.hash.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
