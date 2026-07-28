import { expect, test } from '@playwright/test';
import { totp, totpStep, waitForFreshTotpWindow } from './totp';

const PASSWORD = 'correct horse battery staple';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@gather.test`;
}

test('health endpoint reports a migrated database', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    status: 'ok',
    db: 'ok',
    migrations: 'applied',
  });
});

test('owner signs up, enrols TOTP, and signs back in with an authenticator code', async ({
  page,
}) => {
  const email = uniqueEmail('owner');

  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Alex Owner');
  await page.getByLabel('Firm name').fill('Owner & Co Accountants');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Two-factor is required by default, so the new owner lands on setup, not the dashboard.
  await expect(page).toHaveURL(/\/account\/security/);
  await expect(page.getByText('Account created')).toBeVisible();

  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();

  const secret = (await page.getByTestId('totp-secret').innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  const backupCodes = (await page.getByTestId('backup-codes').innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  expect(backupCodes.length).toBeGreaterThan(0);

  const enrolStep = totpStep();
  await page.getByLabel('Enter the current 6-digit code to finish').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // Signing in with the password alone must not be enough any more.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/two-factor/);

  await waitForFreshTotpWindow(enrolStep);
  await page.getByLabel('6-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Owner & Co Accountants' })).toBeVisible();

  // The audit trail is populated by the flow that just ran, not by seed data.
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
  await expect(page.getByText('Firm created')).toBeVisible();
  await expect(page.getByText('Two-factor code verified').first()).toBeVisible();
  // Sign-out is recorded before the session is revoked, so it must be here too.
  await expect(page.getByText('Signed out')).toBeVisible();
});

test('a wrong two-factor code is refused', async ({ page }) => {
  const email = uniqueEmail('wrongcode');

  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Blocked User');
  await page.getByLabel('Firm name').fill('Blocked LLP');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account\/security/);

  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  await expect(page.getByTestId('totp-secret')).toBeVisible();

  await page.getByLabel('Enter the current 6-digit code to finish').fill('000000');
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/account\/security/);
});

test('the dashboard is unreachable without two-factor set up', async ({ page }) => {
  const email = uniqueEmail('nofactor');

  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Halfway User');
  await page.getByLabel('Firm name').fill('Halfway Bookkeeping');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account\/security/);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/account\/security\?required=1/);
  await expect(page.getByText('Two-factor is required on this install')).toBeVisible();
});

test('signed-out visitors are sent to sign in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
});
