import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Button, Card, PageHeader } from '@/components/ui';
import { getClient } from '@/lib/clients';
import { requireReadyUser } from '@/lib/session';
import { setClientArchivedAction, updateClientAction } from '../actions';
import { ClientForm } from '../client-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit client · Gather' };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { membership } = await requireReadyUser();
  const { id } = await params;
  const entry = await getClient(membership.firm.id, id);
  if (!entry) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title={entry.name} description={entry.email} />

      {entry.archivedAt ? (
        <Alert tone="warning" title="This client is archived">
          They stay in your records and on any request they already have. Restore them to send
          anything new.
        </Alert>
      ) : null}

      <Card>
        <ClientForm action={updateClientAction} submitLabel="Save changes" values={entry} />
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-slate-900">
          {entry.archivedAt ? 'Restore this client' : 'Archive this client'}
        </h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          {entry.archivedAt
            ? 'They will appear in the client list again.'
            : 'Archiving hides them from the client list. Nothing is deleted — requests you have already sent them are evidence, and stay exactly as they are.'}
        </p>
        <form action={setClientArchivedAction}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="archived" value={entry.archivedAt ? 'false' : 'true'} />
          <Button type="submit" variant={entry.archivedAt ? 'secondary' : 'danger'}>
            {entry.archivedAt ? 'Restore client' : 'Archive client'}
          </Button>
        </form>
      </Card>

      <p className="text-sm">
        <Link href="/clients" className="text-brand-700 underline">
          Back to clients
        </Link>
      </p>
    </div>
  );
}
