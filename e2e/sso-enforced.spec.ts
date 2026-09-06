import { expect, test, type Page } from '@playwright/test';
import { sql } from './mailbox';

/**
 * Single sign-on, enforced.
 *
 * The second pass of `pnpm test:sso`, against the same real Keycloak but a stack configured
 * the way an enterprise would run it: no Gather passwords at all, and only one email domain
 * admitted.
 *
 * That configuration is the point. "SSO available" and "SSO enforced" are different
 * products: the first is a convenience, the second is the reason an IT department will
 * deploy this — joiners and leavers live in one system, and an account disabled there
 * cannot get in here through a password nobody remembered to change.
 */

const KEYCLOAK_PASSWORD = 'correct horse battery staple';
const STAFF_EMAIL = 'dana@delgado.example.com';
const OUTSIDE_EMAIL = 'sam@outside.example.org';

async function signInAtProvider(page: Page, username: string): Promise<void> {
  await expect(page).toHaveURL(/keycloak:\d+\/realms\/gather/, { timeout: 30_000 });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(KEYCLOAK_PASSWORD);
  await page.locator('#kc-login').click();
}

test.beforeEach(() => {
  for (const email of [STAFF_EMAIL, OUTSIDE_EMAIL]) {
    sql(`delete from "user" where email = '${email}'`);
  }
});

test('⑤ there is no password to sign in with, anywhere', async ({ page }) => {
  await page.goto('/sign-in');

  await expect(page.getByTestId('sso-sign-in')).toBeVisible();
  // Not merely hidden: there is no password field on the page, because the credential
  // provider is switched off in Better Auth rather than styled away.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText(/signs in through Keycloak/i)).toBeVisible();

  // Sign-up is a dead end too, and says where to go instead of showing a form nobody can
  // complete.
  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: /Sign in with Keycloak/i })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  // And the server agrees — the endpoint is gone, not just the form.
  const forged = await page.request.post('/api/auth/sign-in/email', {
    data: { email: STAFF_EMAIL, password: KEYCLOAK_PASSWORD },
  });
  expect(
    forged.status(),
    'password sign-in answered something other than a refusal',
  ).toBeGreaterThanOrEqual(400);
});

test('⑥ an identity outside the allowed domain is refused, in words it can act on', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByTestId('sso-sign-in').click();

  // Sam authenticates perfectly well at the provider. The provider is not the thing saying
  // no — this install is, because sam@outside.example.org is not on the allowed domain.
  await signInAtProvider(page, 'sam');

  await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 20_000 });
  expect(
    Number(sql(`select count(*) from "user" where email = '${OUTSIDE_EMAIL}'`)),
    'an identity outside the allowed domain was given an account',
  ).toBe(0);
});

test('⑦ an allowed identity gets in, and is not asked for a second factor', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('sso-sign-in').click();
  await signInAtProvider(page, 'dana');

  // The install requires two-factor. Dana has no TOTP and is not asked for one: the
  // provider did the authenticating and is where this organisation administers MFA.
  // Asking again would be a second secret in the same password manager, not more security.
  await expect(page).toHaveURL(/\/(create-firm|dashboard)/, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/account\/security/);

  const session = await page.request.get('/api/auth/get-session');
  const body = (await session.json()) as { user: { email: string; twoFactorEnabled?: boolean } };
  expect(body.user.email).toBe(STAFF_EMAIL);
  expect(body.user.twoFactorEnabled ?? false).toBe(false);
});

test('⑧ with more than one firm on the install, nobody is auto-joined to either', async ({
  page,
}) => {
  const firms = Number(sql('select count(*) from firm'));
  test.skip(
    firms < 2,
    'this stack has fewer than two firms, so there is nothing to be wrong about',
  );

  await page.goto('/sign-in');
  await page.getByTestId('sso-sign-in').click();
  await signInAtProvider(page, 'dana');

  // Auto-join is on for this pass. With two firms present there is no right answer to
  // "which one", so Gather does nothing and the person lands on the ordinary path —
  // rather than inside a stranger's client list.
  await expect(page).toHaveURL(/\/create-firm/, { timeout: 30_000 });
  expect(
    Number(
      sql(
        `select count(*) from firm_user fu join "user" u on u.id = fu.user_id
          where u.email = '${STAFF_EMAIL}'`,
      ),
    ),
    'a new SSO user was put into a firm despite the install having several',
  ).toBe(0);
});
