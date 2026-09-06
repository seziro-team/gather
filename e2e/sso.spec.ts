import { expect, test, type Page } from '@playwright/test';
import { sql } from './mailbox';

/**
 * Single sign-on, against a real identity provider.
 *
 * Opt-in: `pnpm test:sso` brings up Gather with a real Keycloak and runs this file. There
 * is no mock anywhere in it. The browser is redirected to Keycloak, types a password into
 * Keycloak's own login page, and comes back with an authorization code that Gather
 * exchanges server-side for a real signed ID token.
 *
 * What that buys, and what a unit test could not: the discovery document is really fetched,
 * the PKCE challenge is really verified, the `iss` is really checked, and the account
 * Gather creates really carries the identity the provider asserted.
 *
 * Gather has no idea it is talking to Keycloak. It reads a discovery URL — which is what it
 * does against Okta, Entra ID, Google Workspace or Authentik.
 */

const KEYCLOAK_PASSWORD = 'correct horse battery staple';
const STAFF_EMAIL = 'dana@delgado.example.com';
const OUTSIDE_EMAIL = 'sam@outside.example.org';

/** Signs in at the provider's own page. Nothing here is Gather's UI. */
async function signInAtProvider(page: Page, username: string): Promise<void> {
  await expect(page).toHaveURL(/keycloak:\d+\/realms\/gather/, { timeout: 30_000 });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(KEYCLOAK_PASSWORD);
  await page.locator('#kc-login').click();
}

/** Removes an account between runs, so each test starts from a first-ever sign-in. */
function forget(email: string): void {
  sql(`delete from "user" where email = '${email}'`);
}

test.beforeEach(() => {
  forget(STAFF_EMAIL);
  forget(OUTSIDE_EMAIL);
});

test('① the discovery document is real, and Gather reads it rather than hard-coding endpoints', async ({
  request,
}) => {
  // Fetched over the published port rather than through `keycloak`: the host-resolver rule
  // is a *browser* flag, and this request comes from Node. Same provider, same document —
  // and the issuer it reports is asserted below to be the name Gather validates against.
  const port = process.env.KEYCLOAK_PORT ?? '8081';
  const response = await request.get(
    `http://127.0.0.1:${port}/realms/gather/.well-known/openid-configuration`,
  );
  expect(response.status()).toBe(200);

  const document = (await response.json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
    code_challenge_methods_supported?: string[];
  };

  // The issuer Gather validates against, straight from the provider.
  expect(document.issuer).toBe('http://keycloak:8081/realms/gather');
  expect(document.authorization_endpoint).toContain('/protocol/openid-connect/auth');
  expect(document.token_endpoint).toContain('/protocol/openid-connect/token');
  expect(document.jwks_uri).toContain('/protocol/openid-connect/certs');
  // PKCE is not optional in the client config, so the provider had better support it.
  expect(document.code_challenge_methods_supported ?? []).toContain('S256');
});

test('② a first-ever sign-in creates the account the provider asserted', async ({ page }) => {
  await page.goto('/sign-in');

  // The button exists because a provider is configured — not because a flag was flipped.
  const button = page.getByTestId('sso-sign-in');
  await expect(button).toBeVisible();
  await expect(button).toContainText('Keycloak');

  await button.click();
  await signInAtProvider(page, 'dana');

  // Back in Gather, signed in, with no Gather password ever set. Two-factor is required on
  // this stack and SSO is not enforced, so the honest landing place is enrolment.
  await expect(page).toHaveURL(/\/(account\/security|create-firm|dashboard)/, {
    timeout: 30_000,
  });

  const session = await page.request.get('/api/auth/get-session');
  const body = (await session.json()) as { user: { email: string; name: string } };
  expect(body.user.email).toBe(STAFF_EMAIL);
  // The name came from the provider's profile claims, not from a form.
  expect(body.user.name).toContain('Dana');

  // An `account` row for the provider is what makes this an SSO identity rather than a
  // password account that happens to share an address.
  expect(
    Number(sql(`select count(*) from account where provider_id = 'sso'`)),
    'no linked SSO account row was written',
  ).toBe(1);

  // And no password credential exists for them anywhere.
  expect(
    Number(
      sql(
        `select count(*) from account a join "user" u on u.id = a.user_id
          where u.email = '${STAFF_EMAIL}' and a.password is not null`,
      ),
    ),
  ).toBe(0);
});

test('③ signing in again returns to the same account, not a second one', async ({ browser }) => {
  for (const attempt of [1, 2]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/sign-in');
    await page.getByTestId('sso-sign-in').click();

    if (attempt === 1) {
      await signInAtProvider(page, 'dana');
    } else {
      // The provider still has a session, so it may not ask again — either way we end up
      // back in Gather.
      await page
        .locator('#username')
        .waitFor({ timeout: 8_000 })
        .then(() => signInAtProvider(page, 'dana'))
        .catch(() => {});
    }

    await expect(page).toHaveURL(/\/(account\/security|create-firm|dashboard)/, {
      timeout: 30_000,
    });
    await context.close();
  }

  // The property that matters: one identity, one user. A second row here would mean
  // somebody's second sign-in landed in an empty account holding none of their firm's work.
  expect(Number(sql(`select count(*) from "user" where email = '${STAFF_EMAIL}'`))).toBe(1);
  expect(Number(sql(`select count(*) from account where provider_id = 'sso'`))).toBe(1);
});

test('④ every sign-in is in the audit trail', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('sso-sign-in').click();
  await signInAtProvider(page, 'dana');
  await expect(page).toHaveURL(/\/(account\/security|create-firm|dashboard)/, {
    timeout: 30_000,
  });

  // Who signed in, and how. An SSO install that cannot answer "when did this person last
  // authenticate" has given up the thing the audit trail is for.
  await expect
    .poll(
      () =>
        Number(
          sql(
            `select count(*) from audit_event
              where action = 'auth.sso.sign_in' and created_at > now() - interval '2 minutes'`,
          ),
        ),
      { message: 'the SSO sign-in was not recorded', timeout: 15_000 },
    )
    .toBeGreaterThan(0);
});
