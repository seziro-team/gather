import Link from 'next/link';
import { count, desc, eq, isNull, and } from 'drizzle-orm';
import { auditEvent, client, getDb, request } from '@gather/db';
import { Alert, Card, linkButton } from '@/components/ui';
import { requireReadyUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard · Gather' };

const ACTION_LABELS: Record<string, string> = {
  'auth.sign_up': 'Account created',
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'auth.two_factor.enable_requested': 'Two-factor setup started',
  'auth.two_factor.verified': 'Two-factor code verified',
  'auth.two_factor.disabled': 'Two-factor turned off',
  'auth.two_factor.backup_code_used': 'Backup code used',
  'firm.created': 'Firm created',
  'firm.member_added': 'Member added',
  'client.created': 'Client added',
  'client.updated': 'Client updated',
  'client.archived': 'Client archived',
  'client.restored': 'Client restored',
  'request.created': 'Request created',
  'request.updated': 'Request details changed',
  'request.structure_updated': 'Checklist changed',
  'request.deleted': 'Request deleted',
  'template.created': 'Template saved',
  'template.deleted': 'Template deleted',
};

export default async function DashboardPage() {
  const { membership } = await requireReadyUser();
  const db = getDb();
  const firmId = membership.firm.id;

  const [clientCount, requestCount, recent] = await Promise.all([
    db
      .select({ total: count() })
      .from(client)
      .where(and(eq(client.firmId, firmId), isNull(client.archivedAt))),
    db.select({ total: count() }).from(request).where(eq(request.firmId, firmId)),
    db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.firmId, firmId))
      .orderBy(desc(auditEvent.id))
      .limit(10),
  ]);

  const formatter = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: membership.firm.timezone,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{membership.firm.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Signed in as {membership.role}. Times shown in {membership.firm.timezone}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm font-medium text-slate-500">Document requests</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {requestCount[0]?.total ?? 0}
          </p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">Active clients</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">{clientCount[0]?.total ?? 0}</p>
        </Card>
      </div>

      {requestCount[0]?.total ? null : (
        <Alert tone="info" title="Start here">
          Add a client, then build their request from one of the four included templates — or from
          nothing, if you would rather. Sending the request to the client, and the reminders that
          chase it, arrive in the next two releases.
        </Alert>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href="/requests/new" className={linkButton()}>
          New request
        </Link>
        <Link href="/clients/new" className={linkButton('secondary')}>
          Add client
        </Link>
        <Link href="/templates" className={linkButton('secondary')}>
          Browse templates
        </Link>
      </div>

      <Card>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Audit trail</h2>
          <p className="text-xs text-slate-500">
            Hash-chained and append-only. Verify it with <code>pnpm verify:audit</code>.
          </p>
        </div>

        {recent.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing recorded for this firm yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className="font-mono text-xs text-slate-400">#{event.id}</span>
                <span className="text-sm font-medium text-slate-900">
                  {ACTION_LABELS[event.action] ?? event.action}
                </span>
                <span className="text-sm text-slate-500">{formatter.format(event.createdAt)}</span>
                {event.ip ? <span className="text-xs text-slate-400">from {event.ip}</span> : null}
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

      <p className="text-sm text-slate-600">
        Manage your second factor in{' '}
        <Link href="/account/security" className="text-brand-700 font-medium underline">
          Security
        </Link>
        .
      </p>
    </div>
  );
}
