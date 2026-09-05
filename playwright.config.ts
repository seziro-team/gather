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
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The portal suite is a mobile test. Running it here too would prove only that a
      // 1280px window has no horizontal overflow, which is not the claim being made.
      testIgnore: /portal-mobile\.spec\.ts/,
    },
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
