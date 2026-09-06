import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The suite tests *this* install, so it has to agree with it about configuration — which
// address reminders come from, which port the app is on. Reading the same .env the
// containers were started with is what keeps the two from drifting. `loadEnvFile` never
// overwrites a variable that is already set, so CI and the shell still win.
if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * End-to-end tests run against a running Gather, not a mock: `docker compose up -d`
 * first, or point GATHER_E2E_URL at any install.
 *
 * The install under test must allow sign-ups (GATHER_ALLOW_SIGNUP=open), because each
 * run creates its own account rather than depending on leftover state.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  outputDir: 'artifacts/e2e',
  use: {
    // Must be the same origin as the install's GATHER_APP_URL, which is what
    // .env.example sets. Gather builds portal links from GATHER_APP_URL and scopes the
    // portal cookie by path on that host — so pointing the tests at 127.0.0.1 while the
    // app calls itself localhost means the cookie is set on one host and never sent to
    // the other, and every portal test fails as though the session had expired.
    // That is not a test artefact: it is exactly what a self-hoster gets wrong when
    // GATHER_APP_URL does not match the address people actually use.
    baseURL: process.env.GATHER_E2E_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  /*
   * The antivirus suite is opt-in.
   *
   * It needs the ClamAV overlay and ~3 GiB of RAM, so a plain `playwright test` on a
   * default stack would run it against a scanner that is not there and fail for a reason
   * that says nothing about the product. `pnpm test:antivirus` sets the flag; CI gives it
   * its own job with its own stack.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The portal suite is a mobile test. Running it here too would prove only that a
      // 1280px window has no horizontal overflow, which is not the claim being made.
      // The portal suite is a mobile test; the antivirus suite needs the opt-in ClamAV
      // profile and is run by its own script against its own stack.
      testIgnore: [
        /portal-mobile\.spec\.ts/,
        /antivirus\.spec\.ts/,
        /cloud\.spec\.ts/,
        /sso\.spec\.ts/,
        /sso-enforced\.spec\.ts/,
      ],
    },
    /*
     * The hosted tier is opt-in for the same reason: it needs its own stack, with
     * GATHER_CLOUD on. Against a self-hosted install these pages are 404s, and
     * team.spec.ts ④ is the test that asserts that.
     */
    /*
     * Single sign-on, against a real Keycloak. Opt-in for the same reason as the others:
     * it needs its own stack, and on a default install there is no provider to sign in to.
     *
     * `--host-resolver-rules` is the crux. An OIDC redirect goes through the browser while
     * the token exchange happens server-side, and the `iss` in the token is compared
     * against one configured issuer — so both sides have to reach the provider at the same
     * name. `keycloak` resolves inside the compose network; this makes it resolve for the
     * browser too, rather than weakening the check to make a test pass.
     */
    ...(process.env.GATHER_TEST_SSO === '1'
      ? [
          {
            name: 'sso',
            use: {
              ...devices['Desktop Chrome'],
              launchOptions: {
                args: [
                  `--host-resolver-rules=MAP keycloak 127.0.0.1:${process.env.KEYCLOAK_PORT ?? '8081'}`,
                ],
              },
            },
            // The two passes are separate projects because they need differently
            // configured stacks — "SSO available" and "SSO enforced" are different
            // products, and testing only the first proves nothing about the second.
            testMatch:
              process.env.GATHER_TEST_SSO_ENFORCED === '1'
                ? /sso-enforced\.spec\.ts/
                : /sso\.spec\.ts/,
            timeout: 120_000,
          },
        ]
      : []),
    ...(process.env.GATHER_TEST_CLOUD === '1'
      ? [
          {
            name: 'cloud',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /cloud\.spec\.ts/,
          },
        ]
      : []),
    ...(process.env.GATHER_TEST_ANTIVIRUS === '1'
      ? [
          {
            name: 'antivirus',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /antivirus\.spec\.ts/,
            // clamd's first scan after a signature reload is not fast.
            timeout: 300_000,
          },
        ]
      : []),
    {
      name: 'mobile-safari',
      // WebKit, touch, an iOS user agent and a 3× device pixel ratio. The viewport is
      // pinned to plan.md §9's stated 390×844 rather than taken from the device profile,
      // whose 390×664 models an iPhone with browser chrome subtracted.
      use: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } },
      testMatch: /portal-mobile\.spec\.ts/,
      // Each of these drives two devices through a full sign-up, TOTP enrolment, client,
      // request and checklist before the part being tested even starts — and WebKit is
      // roughly twice Chromium's wall-clock on that setup. The default 60s is not a
      // meaningful assertion about the product, so it is raised rather than worked around.
      timeout: 240_000,
    },
  ],
});
