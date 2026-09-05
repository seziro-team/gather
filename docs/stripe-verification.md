# Verifying Stripe billing

**Status: written, compiled, unit-tested — never run against Stripe.**

Gather's billing code has never made a successful call to Stripe, because nobody has given
this build a Stripe account. This document is the checklist that turns that into "proven",
and it exists so the gap is a task with a procedure rather than a sentence in a commit
message that everyone forgets.

Nothing here affects a self-hosted install. `GATHER_CLOUD=false` is the default, there is no
billing page, and none of this code is reachable. See [`../README.md`](../README.md).

## What is already proven

- The webhook signature check, the event→state mapping and the plan/status arithmetic have
  real unit tests: `packages/billing/src/billing.test.ts`, `packages/core/src/plans.test.ts`.
- Every parameter of every Stripe call typechecks against the official SDK (`stripe@22.6.1`,
  API version `2026-08-26.dahlia` — pinned in `packages/billing/src/index.ts`, because an
  SDK that silently follows the account's default version turns a `pnpm update` into a
  billing change).
- The button reaches Stripe. `pnpm test:cloud` runs against placeholder credentials, and
  `e2e/cloud.spec.ts` ③ asserts that Stripe answers and the refusal is shown to the user:

  ```
  {"level":"error","msg":"could not start a Stripe checkout",
   "error":"Invalid API Key provided: sk_test_*****************************_yet"}
  ```

  That proves the call is real. It does not prove a subscription can be created.

## What is not proven

- Creating a Checkout Session and completing it.
- The webhook arriving, verifying, and writing a subscription.
- The customer portal opening for a real customer.
- Cancellation, `past_due`, and the fallback to entry-plan limits after a real lapse.

## The procedure

You need a Stripe account in test mode. It is free and takes about ten minutes.

### 1. Products and prices

Create two recurring products at <https://dashboard.stripe.com/test/products>:

| Product          | Price             | `PLAN_DEFINITIONS` key |
| ---------------- | ----------------- | ---------------------- |
| Gather Cloud     | monthly, per firm | `cloud`                |
| Gather Cloud Pro | monthly, per firm | `cloud_pro`            |

Copy the **price** ids (`price_…`), not the product ids (`prod_…`). Amounts live in Stripe,
not in this repo — `packages/core/src/plans.ts` says what a plan includes; Stripe is the
source of truth for what it costs.

### 2. Keys

```
GATHER_CLOUD=true
STRIPE_SECRET_KEY=sk_test_...          # dashboard.stripe.com/test/apikeys
STRIPE_PRICE_CLOUD=price_...
STRIPE_PRICE_CLOUD_PRO=price_...
GATHER_ADMIN_EMAILS=you@yourdomain.com
```

The app refuses to boot with `GATHER_CLOUD=true` and any of these missing. That is
deliberate: a payment button that errors is worse than no payment button.

### 3. Webhook

The webhook is the **only** path that may change a firm's plan — the redirect back from
Checkout deliberately does not, so a client that closes the tab cannot leave a firm
unsubscribed and one that forges the return cannot leave them subscribed.

For a local run, forward events with the Stripe CLI:

```sh
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

It prints a `whsec_…`; put it in `STRIPE_WEBHOOK_SECRET` and restart. For a deployed
install, add an endpoint at `<GATHER_APP_URL>/api/webhooks/stripe` in the dashboard,
subscribed to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### 4. The runs that count

Each of these should end with output pasted into `progress.md`.

1. **Subscribe.** Sign in as an owner → Billing → Subscribe to Gather Cloud. Pay with
   `4242 4242 4242 4242`, any future expiry, any CVC. Expect: a redirect back, and within
   a second or two the page showing **Active** with a renewal date.

   ```sh
   docker compose exec -T db psql -U gather -d gather -c \
     "select plan, status, stripe_customer_id, current_period_end from subscription"
   ```

2. **The webhook did it.** Confirm the row was written by the webhook and not the redirect:

   ```sh
   docker compose exec -T db psql -U gather -d gather -c \
     "select action, actor_type, metadata from audit_event
       where action like 'billing.%' order by id desc limit 5"
   ```

   `billing.subscription_updated` must have `actor_type = 'system'`. If a `'user'` row
   changed the plan, something is writing subscriptions from a browser-reachable path.

3. **A forged return changes nothing.** Visit the Checkout success URL by hand with a
   made-up `session_id`. The plan must not change.

4. **Seat limits move with the plan.** On `cloud` (3 seats) invite until refused; upgrade to
   `cloud_pro`; the limit should rise without a restart.

5. **The portal opens.** Billing → Manage payment and invoices → Stripe's portal, for the
   right customer.

6. **A lapse degrades, and does not lock out.** In the dashboard, cancel the subscription
   immediately. Expect: status **Cancelled**, entry-plan limits, and — the part that
   matters — every request, file and export still reachable. Gather never holds a firm's
   documents hostage; if that is not what happens, it is a bug, not a policy.

7. **Signature checking.** Replay a webhook with a mangled signature:

   ```sh
   curl -i -X POST localhost:3000/api/webhooks/stripe \
     -H 'stripe-signature: t=1,v1=deadbeef' -d '{"type":"customer.subscription.updated"}'
   ```

   Expect `401`, and no change to any subscription. (401 rather than 5xx on purpose: Stripe
   retries 5xx, and a signature that does not verify never will.)

## When it passes

Update `progress.md` with the real output, and change the ⚠️ notes at the top of
`apps/web/src/lib/billing.ts` and `e2e/cloud.spec.ts` — they say this has never run, and
they should stop saying that only when it has.
