'use client';

import { useState, useTransition } from 'react';
import { PLAN_DEFINITIONS, type Plan } from '@gather/core';
import { openBillingPortalAction, startCheckoutAction } from '@/app/(app)/settings/actions';
import { Alert, Badge, Button } from '@/components/ui';

/**
 * The subscription, on the hosted tier only.
 *
 * ⚠️ The two buttons here call Stripe, and Stripe has never been called with a real key on
 * this install — see the note in `lib/billing.ts` and the hard stop in `progress.md`. The
 * failure path is therefore the one that has been exercised: an error from Stripe is shown
 * in full rather than swallowed, because "something went wrong" on a payment screen is the
 * least useful sentence in software.
 */

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  active: 'green',
  trialing: 'green',
  past_due: 'amber',
  canceled: 'red',
  unpaid: 'red',
  none: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Payment failed',
  canceled: 'Cancelled',
  unpaid: 'Unpaid',
  none: 'No subscription',
};

export function BillingPanel({
  plan,
  subscribedPlan,
  status,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  hasCustomer,
  canManage,
  usage,
}: {
  plan: Plan;
  subscribedPlan: Plan;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  canManage: boolean;
  usage: {
    seatsUsed: number;
    seatLimit: number | null;
    storageUsed: string;
    storageLimit: string | null;
  };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function go(work: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      // Stripe hosts both pages, so leaving is the success case.
      if (result.ok) window.location.href = result.url;
      else setError(result.error);
    });
  }

  const definition = PLAN_DEFINITIONS[plan];
  const renewal = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {status === 'past_due' ? (
        <Alert tone="warning" title="The last payment did not go through">
          Nothing has been switched off. Update the card in the billing portal and the next attempt
          will settle it.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{definition.name}</h2>
          <p className="text-sm text-slate-600">{definition.summary}</p>
        </div>
        <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Badge>
      </div>

      {renewal ? (
        <p className="text-sm text-slate-600">
          {cancelAtPeriodEnd
            ? `Ends on ${renewal}. After that this firm goes back to the self-hosted feature set.`
            : `Renews on ${renewal}.`}
        </p>
      ) : null}

      {status === 'none' ? (
        <Alert tone="info" title="No subscription yet">
          Everything works. While you decide, this firm is on the {definition.name} limits below —
          and whatever you have already collected stays yours either way: export it, or run the
          self-hosted product, which has no limits at all.
        </Alert>
      ) : plan !== subscribedPlan ? (
        <Alert tone="info">
          This firm subscribed to {PLAN_DEFINITIONS[subscribedPlan].name}, but the subscription is{' '}
          {STATUS_LABEL[status]?.toLowerCase() ?? status}, so {definition.name} limits apply for
          now. Nothing has been hidden or deleted.
        </Alert>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md bg-slate-50 p-3">
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Seats</dt>
          <dd className="text-sm text-slate-900">
            {usage.seatsUsed}
            {usage.seatLimit === null ? ' (no limit)' : ` of ${usage.seatLimit}`}
          </dd>
        </div>
        <div className="rounded-md bg-slate-50 p-3">
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Storage</dt>
          <dd className="text-sm text-slate-900">
            {usage.storageUsed}
            {usage.storageLimit === null ? ' (no limit)' : ` of ${usage.storageLimit}`}
          </dd>
        </div>
      </dl>

      {canManage ? (
        <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-5">
          {hasCustomer ? (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => go(openBillingPortalAction)}
            >
              {pending ? 'Opening…' : 'Manage payment and invoices'}
            </Button>
          ) : null}

          {(['cloud', 'cloud_pro'] as const)
            .filter((option) => option !== subscribedPlan || status === 'canceled')
            .map((option) => (
              <Button
                key={option}
                variant={option === 'cloud_pro' ? 'primary' : 'secondary'}
                disabled={pending}
                onClick={() => go(() => startCheckoutAction(option))}
              >
                {pending
                  ? 'Opening…'
                  : subscribedPlan === 'self_hosted'
                    ? `Subscribe to ${PLAN_DEFINITIONS[option].name}`
                    : `Switch to ${PLAN_DEFINITIONS[option].name}`}
              </Button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
