import Stripe from 'stripe';
import { effectivePlan, PLAN_DEFINITIONS, type Env, type Plan, env } from '@gather/core';

/**
 * Gather Cloud's billing, via Stripe.
 *
 * ⚠️ **This code has never run against Stripe.** It is written against the official SDK
 * (`stripe` 22.6.1, API version `2026-08-26.dahlia`), so every parameter and every response
 * field is checked at compile time — which is the strongest guarantee available without an
 * account. The webhook signature verification, the event → state mapping and the plan
 * gating are unit-tested and do not need Stripe to be real. **Creating an actual
 * subscription is not proven**; see the hard stop recorded in `progress.md`.
 *
 * Two rules the rest of the file follows.
 *
 * **Stripe is the source of truth, and only webhooks may write.** The redirect back from
 * Checkout is a hint that something probably happened — a client that closes the tab must
 * not leave a firm unsubscribed, and one that forges the redirect must not leave them
 * subscribed. Nothing in `applyEvent` is reachable from a browser.
 *
 * **Losing a subscription never costs a firm its data.** `effectivePlan` falls back to
 * `self_hosted`, which has no limits at all. A failed card must not lock a firm out of its
 * clients' tax records.
 */

export type { Plan } from '@gather/core';

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  /** Stripe price ids, one per paid plan. From the Stripe dashboard. */
  prices: { cloud: string; cloudPro: string };
  appUrl: string;
}

/** `null` when this install is not running the cloud tier, which is almost all of them. */
export function billingConfig(config: Env = env()): BillingConfig | null {
  if (!config.STRIPE_SECRET_KEY || !config.STRIPE_PRICE_CLOUD || !config.STRIPE_PRICE_CLOUD_PRO) {
    return null;
  }
  return {
    secretKey: config.STRIPE_SECRET_KEY,
    webhookSecret: config.STRIPE_WEBHOOK_SECRET ?? '',
    prices: { cloud: config.STRIPE_PRICE_CLOUD, cloudPro: config.STRIPE_PRICE_CLOUD_PRO },
    appUrl: config.GATHER_APP_URL,
  };
}

export function billingEnabled(config: Env = env()): boolean {
  return billingConfig(config) !== null;
}

export function createStripe(config: BillingConfig): Stripe {
  return new Stripe(config.secretKey, {
    // Pinned rather than floating: an API version that changes under a running install is
    // a webhook payload that changes shape without a deploy.
    apiVersion: '2026-08-26.dahlia',
    appInfo: { name: 'Gather', url: 'https://github.com/seziro-team/gather' },
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
}

export function priceFor(config: BillingConfig, plan: Exclude<Plan, 'self_hosted'>): string {
  return plan === 'cloud' ? config.prices.cloud : config.prices.cloudPro;
}

export interface CheckoutInput {
  firmId: string;
  firmName: string;
  /** The owner's address, so Stripe's receipts reach a person rather than a mailbox. */
  email: string;
  plan: Exclude<Plan, 'self_hosted'>;
  /** Reused when the firm has subscribed before, so they keep one customer record. */
  existingCustomerId?: string | null;
}

/**
 * A hosted Checkout page for one firm.
 *
 * `client_reference_id` and the subscription metadata both carry the firm id. Two places
 * because the webhook that matters most (`customer.subscription.updated`) does not carry a
 * checkout session, so metadata on the subscription is the only link back to the firm.
 */
export async function createCheckoutSession(
  stripe: Stripe,
  config: BillingConfig,
  input: CheckoutInput,
): Promise<{ id: string; url: string }> {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceFor(config, input.plan), quantity: 1 }],
    client_reference_id: input.firmId,
    ...(input.existingCustomerId
      ? { customer: input.existingCustomerId }
      : { customer_email: input.email }),
    subscription_data: {
      metadata: { gather_firm_id: input.firmId, gather_plan: input.plan },
    },
    metadata: { gather_firm_id: input.firmId, gather_plan: input.plan },
    success_url: new URL('/settings/billing?checkout=done', config.appUrl).toString(),
    cancel_url: new URL('/settings/billing?checkout=cancelled', config.appUrl).toString(),
    // A firm is a business; the address is needed for VAT and for the invoice.
    billing_address_collection: 'required',
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error('Stripe returned a checkout session with no URL.');
  return { id: session.id, url: session.url };
}

/**
 * The Stripe-hosted page where a firm changes its card, downloads invoices, or cancels.
 *
 * Deliberately not rebuilt in Gather. Card details would then pass through a server that
 * holds tax documents, and cancelling should never be harder than subscribing.
 */
export async function createPortalSession(
  stripe: Stripe,
  config: BillingConfig,
  customerId: string,
): Promise<{ url: string }> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: new URL('/settings/billing', config.appUrl).toString(),
  });
  return { url: session.url };
}

/**
 * Verify a webhook and parse it.
 *
 * The raw body, not a re-serialised object: the signature covers the exact bytes, and a
 * framework that parses JSON first invalidates every event.
 */
export function parseWebhook(
  stripe: Stripe,
  config: BillingConfig,
  rawBody: string,
  signature: string,
): { ok: true; event: Stripe.Event } | { ok: false; reason: string } {
  if (!config.webhookSecret) {
    return { ok: false, reason: 'STRIPE_WEBHOOK_SECRET is not set on this install.' };
  }
  try {
    return {
      ok: true,
      event: stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret),
    };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

/** The events Gather acts on. Everything else is acknowledged and ignored. */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
] as const;

export interface SubscriptionState {
  firmId: string;
  plan: Plan;
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  seatLimit: number | null;
  storageLimitBytes: number | null;
}

/**
 * What an event means for a firm's subscription, as a value.
 *
 * A pure function on purpose: the mapping from Stripe's status vocabulary to Gather's is
 * where the interesting mistakes live — `past_due` meaning "keep working" and `unpaid`
 * meaning "stop" is a decision, not a translation — and it is testable without a database,
 * an HTTP server or a Stripe account.
 *
 * Returns `null` for an event that changes nothing.
 */
export function applyEvent(event: Stripe.Event): SubscriptionState | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const firmId = session.client_reference_id ?? session.metadata?.gather_firm_id;
      if (!firmId) return null;

      // The subscription's own events carry the authoritative status; this one exists to
      // record the customer id as early as possible, so a firm that closes the tab before
      // the subscription event lands still has a billing portal to go to.
      return {
        firmId,
        plan: planFromMetadata(session.metadata?.gather_plan),
        status: 'active',
        stripeCustomerId: idOf(session.customer),
        stripeSubscriptionId: idOf(session.subscription),
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        ...limitsFor(planFromMetadata(session.metadata?.gather_plan)),
      };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const firmId = subscription.metadata?.gather_firm_id;
      if (!firmId) return null;

      const plan = planFromMetadata(subscription.metadata?.gather_plan);
      const status =
        event.type === 'customer.subscription.deleted'
          ? 'canceled'
          : mapStatus(subscription.status);

      return {
        firmId,
        plan,
        status,
        stripeCustomerId: idOf(subscription.customer),
        stripeSubscriptionId: subscription.id,
        currentPeriodEnd: periodEnd(subscription),
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        // The limits that apply *now*: a cancelled subscription falls back to
        // self-hosted, which has none.
        ...limitsFor(effectivePlan(plan, status)),
      };
    }

    default:
      return null;
  }
}

/**
 * Stripe's status vocabulary, mapped to Gather's.
 *
 * `incomplete` and `incomplete_expired` mean a first payment that never succeeded, so the
 * firm never had the plan — `none`, not `canceled`, because there is nothing to have lost.
 */
function mapStatus(status: Stripe.Subscription.Status): SubscriptionState['status'] {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'canceled':
    case 'paused':
      return 'canceled';
    case 'incomplete':
    case 'incomplete_expired':
      return 'none';
    default:
      return 'none';
  }
}

function planFromMetadata(value: string | undefined): Plan {
  return value === 'cloud' || value === 'cloud_pro' ? value : 'cloud';
}

function limitsFor(plan: Plan): { seatLimit: number | null; storageLimitBytes: number | null } {
  const definition = PLAN_DEFINITIONS[plan];
  return { seatLimit: definition.seats, storageLimitBytes: definition.storageBytes };
}

/** Stripe fields are `string | Expandable<T>`; we never expand, so this is always the id. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

/**
 * When the paid period ends.
 *
 * Read from the first subscription item rather than the subscription: Stripe moved
 * `current_period_end` onto items, and the type reflects that. Falls back to any
 * top-level value so an older API version still works.
 */
function periodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
  const seconds =
    item?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end;
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}
