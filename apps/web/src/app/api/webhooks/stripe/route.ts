import type { NextRequest } from 'next/server';
import { handleStripeWebhook } from '@/lib/billing';

/**
 * Stripe telling us what happened to a subscription.
 *
 * The only path that may change a firm's plan. The redirect back from Checkout does not,
 * and that is the point: a client that closes the tab must not leave a firm unsubscribed,
 * and one that forges the return must not leave them subscribed.
 *
 * The raw body is read as text and never re-serialised — the signature covers the exact
 * bytes, and a framework that parses JSON first invalidates every event.
 *
 * Configure it at https://dashboard.stripe.com/webhooks pointing at
 * `<GATHER_APP_URL>/api/webhooks/stripe`, subscribed to `checkout.session.completed` and
 * `customer.subscription.*`. Put the signing secret in STRIPE_WEBHOOK_SECRET.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('No stripe-signature header.', { status: 400 });

  const raw = await request.text();
  const result = await handleStripeWebhook(raw, signature);

  return typeof result.body === 'string'
    ? new Response(result.body, { status: result.status })
    : Response.json(result.body, { status: result.status });
}
