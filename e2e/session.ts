import { expect, type Page } from '@playwright/test';
import { totp } from './totp';

const PASSWORD = 'correct horse battery staple';

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@gather.test`;
}

/**
 * Signs up an owner and finishes two-factor enrolment, leaving the page on the dashboard.
 *
 * Every test that touches firm data needs this: `requireReadyUser` refuses to serve
 * client data to an account without a second factor, which is the point of it.
 */
export async function signUpOwner(page: Page, prefix: string): Promise<{ email: string }> {
  const email = uniqueEmail(prefix);

  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill('Alex Partner');
  await page.getByLabel('Firm name').fill(`${prefix} Accountants`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/account\/security/);
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();

  const secret = (await page.getByTestId('totp-secret').innerText()).trim();
  await page.getByLabel('Enter the current 6-digit code to finish').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  return { email };
}

export async function addClient(page: Page, name: string): Promise<string> {
  const email = uniqueEmail(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  await page.goto('/clients/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole('link', { name })).toBeVisible();
  return email;
}

/** Creates a request and lands on its builder. Pass a template name, or nothing for blank. */
export async function newRequest(
  page: Page,
  title: string,
  templateName?: string,
): Promise<string> {
  await page.goto('/requests/new');
  if (templateName) {
    // Option labels carry their item count ("… (25 items)"), so match on the name and read
    // the value rather than hard-coding a number the templates are free to change.
    const value = await page
      .locator('select[name="templateId"] option')
      .filter({ hasText: templateName })
      .first()
      .getAttribute('value');
    if (!value) throw new Error(`No template option matching "${templateName}"`);
    await page.getByLabel('Start from').selectOption(value);
  }
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create request' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+\/edit$/);

  const id = new URL(page.url()).pathname.split('/')[2];
  if (!id) throw new Error(`Could not read a request id from ${page.url()}`);
  return id;
}

/** The labels currently on screen in the builder, top to bottom. */
export async function itemLabels(page: Page): Promise<string[]> {
  return page
    .getByLabel('What are you asking for?')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
}

export async function saveChecklist(page: Page): Promise<void> {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toContainText('Saved at');
}

/**
 * Builds a one-section checklist out of the item types named, labelling each one, and
 * saves it. Returns nothing — the caller already has the request id from `newRequest`.
 *
 * `types` are the builder's own button labels ("File upload", "Short text", …), so this
 * fails loudly if a type is ever renamed rather than silently building a shorter list.
 */
export async function buildChecklist(
  page: Page,
  section: string,
  items: { type: string; label: string }[],
): Promise<void> {
  await page.getByTestId('add-section').click();
  await page.getByTestId('section-title').fill(section);

  for (const item of items) {
    await page.getByRole('button', { name: `+ ${item.type}` }).click();
  }
  await expect(page.getByTestId('item')).toHaveCount(items.length);

  const labels = page.getByLabel('What are you asking for?');
  for (const [index, item] of items.entries()) {
    await labels.nth(index).fill(item.label);
  }

  await saveChecklist(page);
}

/**
 * Issues a portal link from the firm's side and returns it.
 *
 * The link is shown exactly once — Gather stores only its SHA-256 — so this reads it from
 * the box it appears in rather than from anywhere it could be looked up again. That is the
 * same constraint a real firm is under.
 */
export async function issuePortalLink(page: Page, requestId: string): Promise<string> {
  await page.goto(`/requests/${requestId}`);
  await page.getByTestId('create-link').click();
  await expect(page.getByTestId('issued-link')).toBeVisible();
  const url = (await page.getByTestId('portal-url').innerText()).trim();
  if (!/\/p\/[A-Za-z0-9_-]{20,}$/.test(url)) {
    throw new Error(`That does not look like a portal link: ${url}`);
  }
  return url;
}
