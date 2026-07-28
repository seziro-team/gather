import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { countItems } from '@gather/core';
import { auditEvent, getDb, readRequestStructure } from '@gather/db';
import { StructureOutline } from '@/components/structure';
import { Alert, Badge, Button, Card, linkButton, PageHeader } from '@/components/ui';
import { getRequest } from '@/lib/requests';
import { requireReadyUser } from '@/lib/session';
import { deleteRequestAction } from '../actions';
import { RequestDetailsForm, SaveAsTemplateForm } from './request-forms';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Request · Gather' };

const ACTION_LABELS: Record<string, string> = {
  'request.created': 'Request created',
  'request.updated': 'Details changed',
  'request.structure_updated': 'Checklist changed',
  'template.created': 'Saved as a template',
};

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { membership } = await requireReadyUser();
  const { id } = await params;
  const found = await getRequest(membership.firm.id, id);
  if (!found) notFound();

  const db = getDb();
  const [body, events] = await Promise.all([
    readRequestStructure(db, id),
    db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.firmId, membership.firm.id), eq(auditEvent.requestId, id)))
      .orderBy(desc(auditEvent.id))
      .limit(20),
  ]);

  const required = body.sections.flatMap((section) =>
    section.items.filter((entry) => entry.required),
  ).length;

  const formatter = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: membership.firm.timezone,
  });
  const dateOnly = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
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
        <Badge>{found.request.status === 'draft' ? 'Draft' : found.request.status}</Badge>
        <Badge>
          {body.sections.length} sections · {countItems(body)} items · {required} required
        </Badge>
        {found.request.dueAt ? (
          <Badge tone="amber">Due {dateOnly.format(found.request.dueAt)}</Badge>
        ) : null}
        {found.request.templateKey ? (
          <Badge tone="brand">From {found.request.templateKey}</Badge>
        ) : null}
      </div>

      <Alert tone="info" title="Not yet sent to anyone">
        Gather has not emailed this client. Magic-link portals arrive in the next release, and
        reminders in the one after — until then this is a checklist you can build, template and
        audit.
      </Alert>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Checklist</h2>
        <StructureOutline body={body} />
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
