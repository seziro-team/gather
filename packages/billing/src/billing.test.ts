import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { applyEvent, createStripe, parseWebhook, priceFor, type BillingConfig } from './index.js';

/**
 * The parts of billing that do not need Stripe to be real.
 *
 * ⚠️ Creating an actual subscription is **not** tested here and has never been run — that
 * needs an account and test-mode keys the operator has not provided, and it is recorded as
 * a hard stop in `progress.md`. What *is* tested is everything that would still be wrong
 * with a working account: whether a forged webhook is refused, and what each event means
 * for a firm's plan.
 *
 * That second one is where the interesting mistakes live. `past_due` meaning "keep
 * working" and `unpaid` meaning "stop" is a decision about how a firm is treated when a
 * card fails, not a translation of Stripe's vocabulary.
 */

const config: BillingConfig = {
  secretKey: 'sk_test_gather',
  webhookSecret: 'whsec_gather_test_secret',
  prices: { cloud: 'price_cloud', cloudPro: 'price_cloud_pro' },
  appUrl: 'https://gather.example',
};

const stripe = createStripe(config);
const FIRM = '9f3c1d2e-0000-4000-8000-000000000001';

/** Sign a payload the way Stripe does, so `constructEvent` accepts it. */
function signed(
  payload: unknown,
  at = Math.floor(Date.now() / 1000),
): { body: string; header: string } {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', config.webhookSecret)
    .update(`${at}.${body}`)
    .digest('hex');
  return { body, header: `t=${at},v1=${signature}` };
}

function subscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  overrides: {
    status?: Stripe.Subscription.Status;
    plan?: string;
    cancelAtPeriodEnd?: boolean;
    periodEnd?: number;
    /** Drops the metadata entirely, which is how an event from elsewhere looks. */
    noFirmId?: boolean;
  } = {},
): Stripe.Event {
  return {
    id: 'evt_test',
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: {
      object: {
        id: 'sub_test',
        object: 'subscription',
        customer: 'cus_test',
        status: overrides.status ?? 'active',
        cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
        metadata: overrides.noFirmId
          ? {}
          : { gather_firm_id: FIRM, gather_plan: overrides.plan ?? 'cloud' },
        items: {
          object: 'list',
          data: [{ current_period_end: overrides.periodEnd ?? 1_800_000_000 }],
          has_more: false,
          url: '',
        },
      },
    },
  } as unknown as Stripe.Event;
}

describe('webhook verification', () => {
  it('accepts a correctly signed event', () => {
    const { body, header } = signed({ id: 'evt_1', type: 'ping', data: { object: {} } });
    const result = parseWebhook(stripe, config, body, header);
    expect(result.ok).toBe(true);
  });

  it('refuses a body that changed by one byte', () => {
    const { body, header } = signed({ id: 'evt_1', type: 'ping', data: { object: {} } });
    const result = parseWebhook(stripe, config, body.replace('ping', 'pong'), header);
    expect(result.ok).toBe(false);
  });

  it('refuses a signature made with a different secret', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'ping' });
    const at = Math.floor(Date.now() / 1000);
    const forged = createHmac('sha256', 'whsec_not_ours').update(`${at}.${body}`).digest('hex');
    const result = parseWebhook(stripe, config, body, `t=${at},v1=${forged}`);
    expect(result.ok).toBe(false);
  });

  it('refuses a replay from outside Stripe’s tolerance', () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 60;
    const { body, header } = signed({ id: 'evt_1', type: 'ping' }, old);
    const result = parseWebhook(stripe, config, body, header);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/timestamp/i);
  });

  it('refuses everything when no webhook secret is configured', () => {
    const { body, header } = signed({ id: 'evt_1', type: 'ping' });
    const result = parseWebhook(stripe, { ...config, webhookSecret: '' }, body, header);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });
});

describe('what an event means for a firm', () => {
  it('records an active subscription with its limits', () => {
    const state = applyEvent(subscriptionEvent('customer.subscription.created'));
    expect(state).toMatchObject({
      firmId: FIRM,
      plan: 'cloud',
      status: 'active',
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      cancelAtPeriodEnd: false,
      seatLimit: 3,
    });
    expect(state!.currentPeriodEnd?.getTime()).toBe(1_800_000_000 * 1000);
  });

  it('keeps a firm on its plan while a failed card is being retried', () => {
    // `past_due` is Stripe still trying. Downgrading here would take a firm's seats away
    // in the hour between a card expiring and somebody noticing the email.
    const state = applyEvent(
      subscriptionEvent('customer.subscription.updated', { status: 'past_due' }),
    );
    expect(state).toMatchObject({ status: 'past_due', plan: 'cloud', seatLimit: 3 });
  });

  it('drops a cancelled firm to self-hosted limits, which are none', () => {
    const state = applyEvent(subscriptionEvent('customer.subscription.deleted'));
    expect(state).toMatchObject({ status: 'canceled', plan: 'cloud' });
    // The plan they *had* is remembered; the limits that apply are self-hosted's.
    expect(state!.seatLimit).toBeNull();
    expect(state!.storageLimitBytes).toBeNull();
  });

  it('treats a first payment that never succeeded as never having subscribed', () => {
    for (const status of ['incomplete', 'incomplete_expired'] as const) {
      const state = applyEvent(subscriptionEvent('customer.subscription.updated', { status }));
      expect(state!.status, status).toBe('none');
      expect(state!.seatLimit, status).toBeNull();
    }
  });

  it('carries Pro’s larger limits', () => {
    const state = applyEvent(
      subscriptionEvent('customer.subscription.updated', { plan: 'cloud_pro' }),
    );
    expect(state).toMatchObject({ plan: 'cloud_pro', seatLimit: 10 });
  });

  it('notes a subscription that will end but has not yet', () => {
    const state = applyEvent(
      subscriptionEvent('customer.subscription.updated', { cancelAtPeriodEnd: true }),
    );
    // Still active, still their plan — "cancelled but paid until March" is a real state.
    expect(state).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, seatLimit: 3 });
  });

  it('ignores an event it cannot attribute to a firm', () => {
    // Somebody else's Stripe account pointed at this endpoint, or a subscription created
    // by hand in the dashboard with no metadata. Ignoring beats guessing.
    expect(
      applyEvent(subscriptionEvent('customer.subscription.updated', { noFirmId: true })),
    ).toBeNull();
  });

  it('ignores event types it does not act on', () => {
    const event = { type: 'invoice.upcoming', data: { object: {} } } as unknown as Stripe.Event;
    expect(applyEvent(event)).toBeNull();
  });

  it('records the customer id from checkout, so the portal works immediately', () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: FIRM,
          customer: 'cus_from_checkout',
          subscription: 'sub_from_checkout',
          metadata: { gather_plan: 'cloud_pro' },
        },
      },
    } as unknown as Stripe.Event;

    expect(applyEvent(event)).toMatchObject({
      firmId: FIRM,
      plan: 'cloud_pro',
      stripeCustomerId: 'cus_from_checkout',
      stripeSubscriptionId: 'sub_from_checkout',
    });
  });
});

describe('prices', () => {
  it('maps each paid plan to its own price', () => {
    expect(priceFor(config, 'cloud')).toBe('price_cloud');
    expect(priceFor(config, 'cloud_pro')).toBe('price_cloud_pro');
  });
});
