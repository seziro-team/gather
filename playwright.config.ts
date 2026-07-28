import { defineConfig, devices } from '@playwright/test';

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
    baseURL: process.env.GATHER_E2E_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
