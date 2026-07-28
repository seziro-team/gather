import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { requireReadyUser } from '@/lib/session';
import { createClientAction } from '../actions';
import { ClientForm } from '../client-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Add client · Gather' };

export default async function NewClientPage() {
  await requireReadyUser();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="Add client" />
      <Card>
        <ClientForm action={createClientAction} submitLabel="Add client" />
      </Card>
      <p className="text-sm">
        <Link href="/clients" className="text-brand-700 underline">
          Back to clients
        </Link>
      </p>
    </div>
  );
}
