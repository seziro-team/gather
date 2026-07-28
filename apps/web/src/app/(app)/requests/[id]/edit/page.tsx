import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDb, readRequestStructure } from '@gather/db';
import { RequestBuilder } from '@/components/builder/request-builder';
import { PageHeader } from '@/components/ui';
import { getRequest } from '@/lib/requests';
import { requireReadyUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit checklist · Gather' };

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { membership } = await requireReadyUser();
  const { id } = await params;
  const found = await getRequest(membership.firm.id, id);
  if (!found) notFound();

  // Structure is fixed once a request has gone out; the server refuses the save too.
  if (found.request.status !== 'draft') redirect(`/requests/${id}`);

  const body = await readRequestStructure(getDb(), id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={found.request.title}
        description={
          <>
            Building the checklist for {found.client.name}. Drag the ⠿ handles to reorder, or focus
            one and use the arrow keys.
          </>
        }
      />
      <RequestBuilder requestId={id} initialBody={body} />
      <p className="text-sm">
        <Link href={`/requests/${id}`} className="text-brand-700 underline">
          Back to the request
        </Link>
      </p>
    </div>
  );
}
