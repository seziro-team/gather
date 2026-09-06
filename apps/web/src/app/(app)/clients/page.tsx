import Link from 'next/link';
import { parsePage, parseSearch } from '@gather/core';
import { Pager, SearchBox } from '@/components/pager';
import { Alert, Badge, Card, linkButton, PageHeader } from '@/components/ui';
import { listClients } from '@/lib/clients';
import { requireReadyUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Clients · Gather' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; q?: string; page?: string }>;
}) {
  const { membership } = await requireReadyUser();
  const query = await searchParams;
  const showArchived = query.archived === '1';
  const search = parseSearch(query.q);

  const clients = await listClients(membership.firm.id, {
    includeArchived: showArchived,
    search,
    page: parsePage(query.page),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="The people you send requests to. A client never creates an account."
        actions={
          <Link href="/clients/new" className={linkButton()}>
            Add client
          </Link>
        }
      />

      <SearchBox
        action="/clients"
        value={search ?? ''}
        placeholder="Search by name, email or company"
        hidden={{ archived: showArchived ? '1' : undefined }}
      />

      <div className="text-sm">
        {showArchived ? (
          <Link href="/clients" className="text-brand-700 underline">
            Hide archived clients
          </Link>
        ) : (
          <Link href="/clients?archived=1" className="text-brand-700 underline">
            Show archived clients
          </Link>
        )}
      </div>

      {clients.total === 0 ? (
        <Alert tone="info" title={search ? 'Nothing matched' : 'No clients yet'}>
          {search
            ? `No client matches “${search}”. Clear the search to see them all.`
            : 'Add the first one and you can build a request for them straight away.'}
        </Alert>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {clients.rows.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-4">
                <div className="min-w-0">
                  <Link
                    href={`/clients/${entry.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {entry.name}
                  </Link>
                  <p className="truncate text-sm text-slate-500">{entry.email}</p>
                </div>
                {entry.company ? (
                  <span className="text-sm text-slate-500">{entry.company}</span>
                ) : null}
                <div className="ml-auto flex items-center gap-3">
                  {entry.archivedAt ? <Badge tone="amber">Archived</Badge> : null}
                  <Link href={`/clients/${entry.id}`} className="text-brand-700 text-sm underline">
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-6 pb-4">
            <Pager
              page={clients}
              basePath="/clients"
              unit="client"
              params={{ archived: showArchived ? '1' : undefined, q: search ?? undefined }}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
