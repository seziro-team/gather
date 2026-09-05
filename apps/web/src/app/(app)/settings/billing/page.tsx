import { notFound } from 'next/navigation';
import { PLAN_DEFINITIONS } from '@gather/core';
import { BillingPanel } from '@/components/billing-panel';
import { Alert, Card, PageHeader } from '@/components/ui';
import { actorCan, cloudEnabled, planContext } from '@/lib/cloud';
import { formatBytes } from '@/lib/format';
import { requireReadyUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Billing · Gather' };

/**
 * Only exists on the hosted tier.
 *
 * A self-hosted install has nothing to buy and no limits to show, so the page is a 404
 * rather than a page saying "upgrade". Advertising a paid tier inside software somebody is
 * already running for free is the behaviour this product exists to be an alternative to.
 */
export default async function BillingPage() {
  if (!cloudEnabled()) notFound();

  const { membership } = await requireReadyUser();
  const context = await planContext(membership.firm.id);
  const definition = PLAN_DEFINITIONS[context.effective];

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description={`The subscription for ${membership.firm.name}.`} />

      {actorCan(membership, 'billing:manage') ? null : (
        <Alert tone="info" title="Only an owner can change the subscription">
          You can see what the firm is on; changing it is an owner’s decision.
        </Alert>
      )}

      <Card>
        <BillingPanel
          plan={context.effective}
          subscribedPlan={context.plan}
          status={context.status}
          currentPeriodEnd={context.currentPeriodEnd?.toISOString() ?? null}
          cancelAtPeriodEnd={context.cancelAtPeriodEnd}
          hasCustomer={context.stripeCustomerId !== null}
          canManage={actorCan(membership, 'billing:manage')}
          usage={{
            seatsUsed: context.seatsUsed,
            seatLimit: definition.seats,
            storageUsed: formatBytes(context.storageUsedBytes),
            storageLimit: definition.storageBytes ? formatBytes(definition.storageBytes) : null,
          }}
        />
      </Card>
    </div>
  );
}
