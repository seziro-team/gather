import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { pickableClients } from '@/lib/clients';
import { requireReadyUser } from '@/lib/session';
import { listTemplates } from '@/lib/templates';
import { NewRequestForm } from './new-request-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'New request · Gather' };

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ templateId?: string }>;
}) {
  const { membership } = await requireReadyUser();
  const [clients, templates, query] = await Promise.all([
    pickableClients(membership.firm.id),
    listTemplates(membership.firm.id),
    searchParams,
  ]);

  // A request belongs to a client, so there is nothing to build here without one.
  if (clients.length === 0) redirect('/clients/new');

  const requested = query.templateId;
  const initialTemplateId = templates.some((entry) => entry.id === requested) ? requested! : '';

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="New request" />
      <Card>
        <NewRequestForm
          clients={clients}
          templates={templates}
          initialTemplateId={initialTemplateId}
        />
      </Card>
      <p className="text-sm">
        <Link href="/requests" className="text-brand-700 underline">
          Back to requests
        </Link>
      </p>
    </div>
  );
}
