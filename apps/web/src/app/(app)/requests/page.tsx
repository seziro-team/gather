import Link from 'next/link';
import { Alert, Badge, Card, linkButton, PageHeader } from '@/components/ui';
import { parsePage, parseSearch } from '@gather/core';
import { Pager, SearchBox } from '@/components/pager';
import { pickableClients } from '@/lib/clients';
import { listRequests } from '@/lib/requests';
import { requireReadyUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Requests · Gather' };

const STATUS_TONE = {
  draft: 'neutral',
  sent: 'brand',
  in_progress: 'brand',
  submitted: 'amber',
  complete: 'green',
  archived: 'neutral',
} as const;

const STATUS_LABEL = {
  draft: 'Draft',
  sent: 'Sent',
  in_progress: 'In progress',
  submitted: 'Submitted',
  complete: 'Complete',
  archived: 'Archived',
} as const;

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { membership } = await requireReadyUser();
  const query = await searchParams;
  const search = parseSearch(query.q);

  const [requests, clients] = await Promise.all([
    listRequests(membership.firm.id, { search, page: parsePage(query.page) }),
    pickableClients(membership.firm.id),
  ]);

  const formatter = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: membership.firm.timezone,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document requests"
        description="One request per client, per job. Build it once and save it as a template."
        actions={
          clients.length > 0 ? (
            <Link href="/requests/new" className={linkButton()}>
              New request
            </Link>
          ) : null
        }
      />

      {clients.length === 0 ? (
        <Alert tone="info" title="Add a client first">
          A request belongs to a client, so there is nobody to send this to yet.{' '}
          <Link href="/clients/new" className="font-medium underline">
            Add your first client
          </Link>
          .
        </Alert>
      ) : null}

      {clients.length > 0 ? (
        <SearchBox
          action="/requests"
          value={search ?? ''}
          placeholder="Search by title, client or email"
        />
      ) : null}

      {requests.total === 0 ? (
        clients.length > 0 ? (
          <Alert tone="info" title={search ? 'Nothing matched' : 'No requests yet'}>
            {search
              ? `No request matches “${search}”. Clear the search to see them all.`
              : 'Start from one of the four included templates and you will have a real checklist in about ten seconds.'}
          </Alert>
        ) : null
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {requests.rows.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
                <div className="min-w-0">
                  <Link
                    href={`/requests/${entry.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {entry.title}
                  </Link>
                  <p className="truncate text-sm text-slate-500">
                    {entry.clientName} · {entry.clientEmail}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Badge>{entry.itemCount} items</Badge>
                  {entry.dueAt ? (
                    <Badge tone="amber">Due {formatter.format(entry.dueAt)}</Badge>
                  ) : null}
                  <Badge tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-6 pb-4">
            <Pager
              page={requests}
              basePath="/requests"
              unit="request"
              params={{ q: search ?? undefined }}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
