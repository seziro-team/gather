import { expect, test, type Page } from '@playwright/test';
import { sql } from './mailbox';
import { signUpOwner, uniqueEmail } from './session';
import { totp } from './totp';

const PASSWORD = 'correct horse battery staple';

/**
 * Phase 7 — Gather Cloud, running.
 *
 * Opt-in, because it needs the cloud overlay: `pnpm test:cloud` brings up a stack with
 * GATHER_CLOUD=true and runs this file against it. On the default self-hosted stack these
 * pages do not exist, and team.spec.ts ④ asserts exactly that.
 *
 * ⚠️ What this does NOT prove: a Stripe subscription. The stack boots with placeholder
 * credentials, so pressing Subscribe reaches Stripe and comes back rejected. That is
 * deliberately asserted below — a dead button and a wired button that fails on
 * authentication look identical from the outside, and only one of them is honest about it.
 * Real checkout is a hard stop recorded in progress.md and docs/stripe-verification.md.
 */

/**
 * The operator's address.
 *
 * The cloud overlay sets `GATHER_ADMIN_EMAILS=@seziro.test`, so any address on that domain
 * is an operator and each run can make a fresh one — an account cannot be created twice,
 * and re-running with a fixed address would mean signing in with a two-factor secret
 * nobody kept.
 */
const ADMIN_DOMAIN = process.env.GATHER_TEST_ADMIN_DOMAIN ?? 'seziro.test';

test.beforeAll(() => {
  test.skip(
    process.env.GATHER_TEST_CLOUD !== '1',
    'Cloud tests need the hosted-tier stack — run `pnpm test:cloud`.',
  );
});

async function enrolTotp(page: Page): Promise<void> {
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.getByTestId('totp-secret').innerText()).trim();
  await page.getByLabel('Enter the current 6-digit code to finish').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function invite(page: Page, email: string): Promise<void> {
  await page.goto('/settings/team');
  await page.getByLabel('Their email').fill(email);
  await page.getByRole('button', { name: 'Send invitation' }).click();
}

test('① the hosted tier shows a real subscription state and real usage', async ({ page }) => {
  await signUpOwner(page, 'cloud-billing');

  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Billing' })).toBeVisible();

  await page.goto('/settings/billing');
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.getByText('No subscription yet')).toBeVisible();

  // Usage is measured, not asserted at a guess: one person, nothing stored yet.
  await expect(page.getByText('1 of 3')).toBeVisible();
  await expect(page.getByText('0 B of 25 GB')).toBeVisible();

  // The promise that survives not paying, in the product rather than only in a README.
  await expect(page.getByText(/stays yours either way/)).toBeVisible();
});

test('② the seat limit is enforced, counting invitations that have not been accepted', async ({
  page,
}) => {
  await signUpOwner(page, 'cloud-seats');

  // The entry plan is three seats. One is the owner, so two invitations fill it.
  await invite(page, uniqueEmail('seat-two'));
  await expect(page.getByTestId('invite-url')).toBeVisible();
  await invite(page, uniqueEmail('seat-three'));
  await expect(page.getByTestId('invite-url')).toBeVisible();

  await page.goto('/settings/team');
  await expect(page.getByText('3 of 3 seats used.')).toBeVisible();

  // The fourth is refused before an invitation exists — not after somebody accepts it and
  // has to be removed again.
  await expect(page.getByText(/no seats left|seat/i).first()).toBeVisible();
  await expect(page.getByLabel('Their email')).toBeDisabled();

  await page.goto('/settings/billing');
  await expect(page.getByText('3 of 3')).toBeVisible();
});

test('③ Subscribe really calls Stripe, and says so when Stripe refuses', async ({ page }) => {
  await signUpOwner(page, 'cloud-checkout');
  await page.goto('/settings/billing');

  await page.getByRole('button', { name: 'Subscribe to Gather Cloud', exact: true }).click();

  // With placeholder credentials Stripe answers, and it answers "no". The error is shown
  // in full: a payment screen that says "something went wrong" is useless to the person
  // reading it and to whoever they email about it.
  //
  // Scoped past Next's route announcer, which is also role=alert and always empty.
  const alert = page.getByRole('alert').filter({ hasText: 'Stripe' });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText(/API key|Invalid|authentication/i);

  // Nothing was written. A failed call must not leave a firm looking subscribed.
  await page.reload();
  await expect(page.getByText('No subscription yet')).toBeVisible();
});

test('④ the operator console lists every firm, and nobody else can open it', async ({
  browser,
}) => {
  // Unique names, because the console lists every firm on the install — including the ones
  // left behind by the last run of this file.
  const stamp = Date.now();
  const tenantPrefix = `cloud-tenant-${stamp}`;
  const operatorFirm = `Seziro Operations ${stamp}`;
  const operatorEmail = `operator-${stamp}@${ADMIN_DOMAIN}`;

  // An ordinary firm, whose existence the operator should be able to see.
  const firmContext = await browser.newContext();
  const firm = await firmContext.newPage();
  await signUpOwner(firm, tenantPrefix);

  // A signed-in firm user is not an operator, and must not learn the console exists.
  expect((await firm.request.get('/admin')).status()).toBe(404);
  await firm.goto('/dashboard');
  await expect(firm.getByRole('link', { name: 'Admin' })).toBeHidden();

  // The operator: an ordinary account whose address is in GATHER_ADMIN_EMAILS.
  const operatorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  await operator.goto('/sign-up');
  await operator.getByLabel('Your name').fill('Seziro Operator');
  await operator.getByLabel('Firm name').fill(operatorFirm);
  await operator.getByLabel('Email').fill(operatorEmail);
  await operator.getByLabel('Password').fill(PASSWORD);
  await operator.getByRole('button', { name: 'Create account' }).click();
  await expect(operator).toHaveURL(/\/account\/security/);
  await enrolTotp(operator);

  await expect(operator.getByRole('link', { name: 'Admin' })).toBeVisible();
  await operator.goto('/admin');
  await expect(operator.getByRole('heading', { name: 'Platform admin' })).toBeVisible();

  // Real rows for real firms, including the one created a moment ago in another browser.
  await expect(operator.getByRole('cell', { name: new RegExp(tenantPrefix) })).toBeVisible();
  await expect(operator.getByRole('cell', { name: new RegExp(operatorFirm) })).toBeVisible();
  await expect(operator.getByText(/Read-only/)).toBeVisible();

  // Both firms are on the entry plan and neither is paying, which is exactly what the
  // console should say about an install where nobody has subscribed.
  await expect(operator.getByText('Gather Cloud').first()).toBeVisible();

  // Looking is itself an audited event. An operator who can read every firm's activity is
  // exactly the actor a firm most wants a record of, so the record has to exist — and it is
  // a platform event with no firm attached, which is why it is read from the trail directly
  // rather than from any one firm's export.
  const viewed = sql(
    `select count(*) from audit_event
      where action = 'admin.console_viewed' and firm_id is null
        and created_at > now() - interval '5 minutes'`,
  );
  expect(Number(viewed)).toBeGreaterThan(0);

  await firmContext.close();
  await operatorContext.close();
});
