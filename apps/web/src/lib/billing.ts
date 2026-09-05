import { env, type Plan } from '@gather/core';
import { appendAuditEvent, applySubscription, firmPlanFor, getDb } from '@gather/db';
import {
  applyEvent,
  billingConfig,
  createCheckoutSession,
  createPortalSession,
  createStripe,
  parseWebhook,
} from '@gather/billing';
import { requirePermission, type Actor } from './actor';
import { cloudEnabled } from './cloud';
import { logger } from './logger';

/**
 * Billing, from the app's side.
 *
 * ⚠️ **The Stripe calls here have never run.** They are written against the official SDK
 * so every parameter is checked at compile time, and the webhook handling is unit-tested
 * without Stripe — but creating a real subscription needs test-mode keys the operator has
 * not provided. Recorded as a hard stop in `progress.md`.
 *
 * On a self-hosted install every function here refuses politely and nothing calls them:
 * there is no billing page, because there is nothing to buy.
 */

export type BillingRedirect = { ok: true; url: string } | { ok: false; error: string };

const NOT_CLOUD: BillingRedirect = {
  ok: false,
  error:
    'This install is self-hosted, so there is nothing to subscribe to. Everything is ' +
    'already included and there are no limits.',
};

export async function startCheckout(
  actor: Actor,
  plan: Exclude<Plan, 'self_hosted'>,
): Promise<BillingRedirect> {
  requirePermission(actor, 'billing:manage');
  if (!cloudEnabled()) return NOT_CLOUD;

  const config = billingConfig();
  if (!config) return NOT_CLOUD;

  const existing = await firmPlanFor(getDb(), actor.firmId);

  try {
    const session = await createCheckoutSession(createStripe(config), config, {
      firmId: actor.firmId,
      firmName: actor.firmName,
      email: await ownerEmail(actor),
      plan,
      existingCustomerId: existing.stripeCustomerId,
    });

    // The intent, not the outcome. Nothing about the firm's plan changes here — only a
    // webhook may do that, so a client that never comes back from Stripe cannot leave a
    // firm subscribed or unsubscribed by accident.
    await getDb().transaction(async (tx) => {
      await appendAuditEvent(tx, {
        action: 'billing.checkout_started',
        actorType: 'user',
        actorId: actor.actorId,
        firmId: actor.firmId,
        targetType: 'firm',
        targetId: actor.firmId,
        metadata: { plan, sessionId: session.id },
        ip: actor.context.ip,
        ua: actor.context.ua,
      });
    });

    return { ok: true, url: session.url };
  } catch (error) {
    logger.error('could not start a Stripe checkout', { error: (error as Error).message });
    return { ok: false, error: `Stripe could not start checkout: ${(error as Error).message}` };
  }
}

export async function openBillingPortal(actor: Actor): Promise<BillingRedirect> {
  requirePermission(actor, 'billing:manage');
  if (!cloudEnabled()) return NOT_CLOUD;

  const config = billingConfig();
  if (!config) return NOT_CLOUD;

  const plan = await firmPlanFor(getDb(), actor.firmId);
  if (!plan.stripeCustomerId) {
    return { ok: false, error: 'This firm has never subscribed, so there is nothing to manage.' };
  }

  try {
    const session = await createPortalSession(createStripe(config), config, plan.stripeCustomerId);
    return { ok: true, url: session.url };
  } catch (error) {
    return {
      ok: false,
      error: `Stripe could not open the billing portal: ${(error as Error).message}`,
    };
  }
}

/**
 * Apply a verified Stripe event.
 *
 * The only path that writes a subscription. Not reachable from a browser: it is called by
 * the webhook route after `parseWebhook` has checked the signature against
 * `STRIPE_WEBHOOK_SECRET`.
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<{ status: number; body: unknown }> {
  const config = billingConfig();
  if (!config || !env().GATHER_CLOUD) {
    return { status: 503, body: 'Billing is not configured on this install.' };
  }

  const parsed = parseWebhook(createStripe(config), config, rawBody, signature);
  if (!parsed.ok) {
    logger.warn('rejected a Stripe webhook', { reason: parsed.reason });
    // 401, not 5xx: Stripe retries on 5xx, and a signature that does not verify never will.
    return { status: 401, body: 'Signature could not be verified.' };
  }

  const state = applyEvent(parsed.event);
  if (!state) return { status: 200, body: { ok: true, ignored: parsed.event.type } };

  await getDb().transaction(async (tx) => {
    await applySubscription(tx, state);
  });

  logger.info('applied a Stripe subscription event', {
    event: parsed.event.type,
    plan: state.plan,
    status: state.status,
  });

  return { status: 200, body: { ok: true, applied: parsed.event.type } };
}

/** The address Stripe should send receipts to: the person doing the subscribing. */
async function ownerEmail(actor: Actor): Promise<string> {
  const { listMembers } = await import('@gather/db');
  const members = await listMembers(getDb(), actor.firmId);
  const self = members.find((member) => member.userId === actor.actorId);
  return self?.email ?? members.find((member) => member.role === 'owner')?.email ?? '';
}
