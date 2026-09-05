import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { auditEvent, getDb } from '@gather/db';
import { RequestChecklist } from '@/components/request-checklist';
import { formatDueDate } from '@/lib/format';
import { Alert, Badge, Button, Card, linkButton, PageHeader } from '@/components/ui';
import { listPortalLinks } from '@/lib/portal';
import { readPortalView } from '@/lib/portal-data';
import { readRemindersView } from '@/lib/reminders';
import { getRequest } from '@/lib/requests';
import { requireReadyUser } from '@/lib/session';
import { deleteRequestAction } from '../actions';
import { RequestDetailsForm, SaveAsTemplateForm } from './request-forms';
import { ReminderSchedule } from './reminder-forms';
import { PortalLinks } from './share-forms';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Request · Gather' };

const ACTION_LABELS: Record<string, string> = {
  'request.created': 'Request created',
  'request.updated': 'Details changed',
  'request.structure_updated': 'Checklist changed',
  'template.created': 'Saved as a template',
  'request.link_issued': 'Portal link created',
  'request.link_revoked': 'Portal link revoked',
  'portal.opened': 'Client opened the link',
  'portal.file_uploaded': 'Client uploaded a file',
  'portal.file_removed': 'Client removed a file',
  'portal.submitted': 'Client sent it back',
  'portal.link_rejected': 'A dead link was tried',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent — not opened yet',
  in_progress: 'Client is working on it',
  submitted: 'Sent back for review',
  complete: 'Complete',
  archived: 'Archived',
};

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { membership } = await requireReadyUser();
  const { id } = await params;
  const found = await getRequest(membership.firm.id, id);
  if (!found) notFound();

  const db = getDb();
  const [view, links, reminders, events] = await Promise.all([
    readPortalView(id),
    listPortalLinks(id),
    readRemindersView(id),
    db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.firmId, membership.firm.id), eq(auditEvent.requestId, id)))
      .orderBy(desc(auditEvent.id))
      .limit(20),
  ]);

  const formatter = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: membership.firm.timezone,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={found.request.title}
        description={
          <>
            For{' '}
            <Link href={`/clients/${found.client.id}`} className="text-brand-700 underline">
              {found.client.name}
            </Link>{' '}
            · {found.client.email}
          </>
        }
        actions={
          <Link href={`/requests/${id}/edit`} className={linkButton()}>
            Edit checklist
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={found.request.status === 'submitted' ? 'green' : 'neutral'}>
          {STATUS_LABELS[found.request.status] ?? found.request.status}
        </Badge>
        <Badge>
          {view.sections.length} sections · {view.total} items · {view.required} required
        </Badge>
        <Badge tone={view.answered === view.total && view.total > 0 ? 'green' : 'neutral'}>
          {view.answered} of {view.total} received
        </Badge>
        {found.request.dueAt ? (
          <Badge tone="amber">Due {formatDueDate(found.request.dueAt)}</Badge>
        ) : null}
        {found.request.templateKey ? (
          <Badge tone="brand">From {found.request.templateKey}</Badge>
        ) : null}
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-slate-900">Share with your client</h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          A portal link needs no account and no password. Send it however you already talk to this
          client, or set up reminders below and let Gather email it. Each link can be revoked on its
          own, and every time one is opened it is recorded below.
        </p>
        <PortalLinks
          requestId={id}
          links={links.map((link) => ({
            id: link.id,
            createdAt: link.createdAt.toISOString(),
            expiresAt: link.expiresAt.toISOString(),
            revokedAt: link.revokedAt?.toISOString() ?? null,
            lastUsedAt: link.lastUsedAt?.toISOString() ?? null,
            opens: link.opens,
          }))}
        />
      </Card>

      {found.request.status === 'draft' ? null : (
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Reminders</h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            Gather emails this client until everything required is in, then stops on its own. The
            time is read on their clock, not yours.
          </p>
          <ReminderSchedule
            requestId={id}
            schedule={reminders.schedule}
            mailConfigured={reminders.mailConfigured}
            firmTimezone={membership.firm.timezone}
            outstanding={reminders.outstanding}
            requiredMissing={reminders.requiredMissing}
            canComplete={found.request.status !== 'complete'}
            log={reminders.log}
          />
        </Card>
      )}

      {found.request.status !== 'draft' ? null : (
        <Alert tone="info" title="Nothing has been sent yet">
          Creating the first link marks this request as sent and freezes your firm’s name and colour
          onto it, so a later rebrand does not change what this client saw.
        </Alert>
      )}

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Checklist</h2>
        <RequestChecklist requestId={id} view={view} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">Details</h2>
          <RequestDetailsForm
            id={id}
            title={found.request.title}
            description={found.request.description}
            dueAt={found.request.dueAt?.toISOString() ?? null}
          />
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-slate-900">Save as template</h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            Copies this checklist into a reusable template. The copy is independent — editing either
            one afterwards leaves the other alone.
          </p>
          <SaveAsTemplateForm id={id} defaultName={found.request.title} />
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">History</h2>
        {events.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing recorded for this request yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((event) => (
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

      <Card>
        <h2 className="text-base font-semibold text-slate-900">Delete this request</h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          The checklist goes; the audit trail above does not. Audit events carry no foreign keys
          precisely so that deleting a request cannot erase the record that it existed.
        </p>
        <form action={deleteRequestAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="danger">
            Delete request
          </Button>
        </form>
      </Card>

      <p className="text-sm">
        <Link href="/requests" className="text-brand-700 underline">
          Back to requests
        </Link>
      </p>
    </div>
  );
}
