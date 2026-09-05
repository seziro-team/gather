import { expect, test, type Page } from '@playwright/test';
import { inboxFor } from './mailbox';
import { addClient, buildChecklist, newRequest, signUpOwner, uniqueEmail } from './session';
import { totp } from './totp';

const PASSWORD = 'correct horse battery staple';

/**
 * Phase 7 — the team, and the wall between firms.
 *
 * Three claims are worth a browser here, and none can be checked in a unit test:
 *
 *  1. An invitation is a link somebody with no account can follow to the end. That path
 *     crosses sign-up, the closed-signups check, two-factor enrolment and the join itself,
 *     and it is the only way a second person ever gets into a firm.
 *
 *  2. A member's missing buttons are a courtesy; the refusal is server-side. Proved by
 *     calling the server action directly, with a real session and no button.
 *
 *  3. **A signed-in user of another firm cannot reach this firm's data.** Every page,
 *     every id, every export. Phase 6 proved a client's portal session is boxed in; this
 *     proves a staff session is too, which is the harder case because that session is
 *     genuinely authenticated — it just belongs to somebody else.
 */

/** Finishes two-factor enrolment for whoever is currently on /account/security. */
async function enrolTotp(page: Page): Promise<void> {
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.getByTestId('totp-secret').innerText()).trim();
  await page.getByLabel('Enter the current 6-digit code to finish').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Invites somebody from the firm's side and returns the link the firm is shown. */
async function inviteFrom(page: Page, email: string, role: string): Promise<string> {
  await page.goto('/settings/team');
  await page.getByLabel('Their email').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption(role);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByTestId('invite-url')).toBeVisible();

  const url = (await page.getByTestId('invite-url').innerText()).trim();
  expect(url).toMatch(/\/join\/[A-Za-z0-9_-]{20,}$/);
  return url;
}

/** Signs up through an invitation link and finishes enrolment. */
async function joinVia(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Join the firm' }).click();
  await expect(page).toHaveURL(/\/account\/security/);
  await enrolTotp(page);
}

/**
 * Finds the opaque id Next.js uses to address a server action.
 *
 * A server action is not a URL — the browser POSTs to the current path with a `Next-Action`
 * header carrying an id baked into the client bundle. To attack one the way a real browser
 * could, the test has to find that id the same way the browser does: read the page's script
 * chunks and look for the `createServerReference` call that names the export.
 *
 * Throws rather than returning empty. A version of Next that changed this encoding would
 * otherwise turn a security assertion into a request that quietly 404s and passes.
 */
async function serverActionId(page: Page, path: string, name: string): Promise<string> {
  await page.goto(path);
  const sources = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).map(
      (script) => (script as HTMLScriptElement).src,
    ),
  );

  const pattern = new RegExp(`createServerReference\\)\\("([0-9a-f]{20,})"[^;]{0,300}?"${name}"`);
  for (const source of sources) {
    const body = await (await page.request.get(source)).text();
    const match = pattern.exec(body);
    if (match?.[1]) return match[1];
  }

  throw new Error(
    `Could not find the server-action id for ${name} in any script on ${path}. If Next.js ` +
      'changed how actions are referenced, this test needs updating — do not delete it, ' +
      'because it is the only check that the permission is enforced on the server.',
  );
}

test('① an invited colleague follows the link, joins the firm, and sees its work', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signUpOwner(owner, 'team-owner');

  // Something for the colleague to find that they did not create themselves.
  await addClient(owner, 'Rivera Landscaping');
  await newRequest(owner, '2025 year-end documents');
  await buildChecklist(owner, 'Bank statements', [
    { type: 'File upload', label: 'December bank statement' },
  ]);

  const colleagueEmail = uniqueEmail('colleague');
  const url = await inviteFrom(owner, colleagueEmail, 'member');

  // The invitation was emailed for real — same SMTP path as a reminder.
  await expect
    .poll(async () => (await inboxFor(colleagueEmail)).map((message) => message.subject), {
      message: 'the invitation never arrived at the SMTP server',
      timeout: 30_000,
    })
    .toEqual([expect.stringContaining('invited')]);

  // Waiting invitations are visible to the firm before they are accepted.
  await expect(owner.getByText(colleagueEmail)).toBeVisible();

  // ── The colleague's side: a different browser, no account, one link ──────────
  const colleagueContext = await browser.newContext();
  const colleague = await colleagueContext.newPage();

  await colleague.goto(url);
  // The invitation decides the shape of this page: no firm-name field, because the firm
  // already exists, and the address is fixed to the one that was invited.
  await expect(colleague.getByRole('heading', { name: /^Join / })).toBeVisible();
  await expect(colleague.getByLabel('Firm name')).toBeHidden();
  await expect(colleague.getByLabel('Email')).toHaveValue(colleagueEmail);

  await colleague.getByLabel('Your name').fill('Sam Colleague');
  await colleague.getByLabel('Password').fill(PASSWORD);
  await colleague.getByRole('button', { name: 'Join the firm' }).click();

  await expect(colleague).toHaveURL(/\/account\/security/);
  await enrolTotp(colleague);

  // In the firm, seeing work they never touched.
  await colleague.goto('/requests');
  await expect(colleague.getByRole('link', { name: '2025 year-end documents' })).toBeVisible();
  await colleague.goto('/clients');
  await expect(colleague.getByRole('link', { name: 'Rivera Landscaping' })).toBeVisible();

  // The owner now sees two people, and nothing still outstanding.
  await owner.goto('/settings/team');
  await expect(owner.getByText('2 people')).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Invitations waiting' })).toBeHidden();

  // ── Single use ──────────────────────────────────────────────────────────────
  // The same link again, in a third browser, must not admit anybody else.
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto(url);
  await expect(
    stranger.getByRole('heading', { name: 'That invitation cannot be used' }),
  ).toBeVisible();
  await expect(stranger.getByText('already been accepted')).toBeVisible();

  await ownerContext.close();
  await colleagueContext.close();
  await strangerContext.close();
});

test('② a member cannot change the team, and the server refuses even without a button', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signUpOwner(owner, 'role-owner');

  const memberEmail = uniqueEmail('member');
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await joinVia(member, await inviteFrom(owner, memberEmail, 'member'), 'Jo Member');

  await member.goto('/settings/team');
  await expect(member.getByText('You can see the team but not change it')).toBeVisible();
  await expect(member.getByRole('button', { name: 'Send invitation' })).toBeHidden();
  await expect(member.getByRole('button', { name: 'Remove' })).toBeHidden();

  // The absent button is a courtesy; the refusal is the control. Call the server action
  // the way a hostile browser would: the member's own session, the real action id lifted
  // out of the page's own JavaScript, and their own user id — a straight self-promotion
  // to owner, with no button involved anywhere.
  const session = await member.request.get('/api/auth/get-session');
  const memberUserId = ((await session.json()) as { user: { id: string } }).user.id;
  expect(memberUserId).toBeTruthy();

  const actionId = await serverActionId(member, '/settings/team', 'changeRoleAction');
  const forged = await member.request.post('/settings/team', {
    headers: { 'Next-Action': actionId, 'Content-Type': 'text/plain;charset=UTF-8' },
    data: JSON.stringify([memberUserId, 'owner']),
  });

  // It runs, and refuses in words the person could act on, rather than 500ing.
  expect(forged.status()).toBe(200);
  expect(await forged.text()).toContain('Only an owner or an admin can manage the team');

  // The decisive assertion: they are still a member.
  await owner.goto('/settings/team');
  const memberRow = owner.locator('li').filter({ hasText: memberEmail });
  await expect(memberRow.getByRole('combobox')).toHaveValue('member');

  // The owner promoting them is the supported path, and it takes effect immediately.
  await memberRow.getByRole('combobox').selectOption('admin');
  await expect(memberRow.getByRole('combobox')).toHaveValue('admin');

  await member.goto('/settings/team');
  await expect(member.getByRole('button', { name: 'Send invitation' })).toBeVisible();

  await ownerContext.close();
  await memberContext.close();
});

test('③ another firm cannot reach this firm’s request, client or exports', async ({ browser }) => {
  const aContext = await browser.newContext();
  const a = await aContext.newPage();
  await signUpOwner(a, 'tenant-a');
  await addClient(a, 'Private Client A');
  const requestId = await newRequest(a, 'Confidential A documents');
  await buildChecklist(a, 'Statements', [{ type: 'File upload', label: 'Statement A' }]);

  await a.goto('/clients');
  const clientHref = await a.getByRole('link', { name: 'Private Client A' }).getAttribute('href');
  const clientId = /\/clients\/([0-9a-f-]{36})/.exec(clientHref ?? '')?.[1] ?? '';
  expect(clientId).toMatch(/^[0-9a-f-]{36}$/);

  // A completely separate firm, signed in, with a valid session and a second factor.
  const bContext = await browser.newContext();
  const b = await bContext.newPage();
  await signUpOwner(b, 'tenant-b');

  const forbidden = [
    `/requests/${requestId}`,
    `/requests/${requestId}/edit`,
    `/requests/${requestId}/download`,
    `/requests/${requestId}/audit.csv`,
    `/clients/${clientId}`,
  ];

  for (const path of forbidden) {
    const response = await b.request.get(path, { maxRedirects: 0 });
    expect(
      [403, 404].includes(response.status()),
      `${path} answered ${response.status()} to another firm — expected 403 or 404`,
    ).toBe(true);

    // And nothing of firm A's leaked into whatever body was returned.
    const body = await response.text();
    expect(body).not.toContain('Confidential A documents');
    expect(body).not.toContain('Private Client A');
  }

  // Firm B's own lists are empty rather than showing A's rows.
  await b.goto('/requests');
  await expect(b.getByText('Confidential A documents')).toHaveCount(0);
  await b.goto('/dashboard');
  await expect(b.getByText('Confidential A documents')).toHaveCount(0);

  // The audit export is scoped the same way: B's own trail contains none of A's events.
  const audit = await b.request.get('/audit');
  expect(audit.status()).toBe(200);
  expect(await audit.text()).not.toContain('Confidential A documents');

  await aContext.close();
  await bContext.close();
});

test('④ a self-hosted install has no billing page and no admin console', async ({ page }) => {
  await signUpOwner(page, 'self-hosted');

  // The install under test has GATHER_CLOUD off, which is what every self-hosted install
  // is. There is nothing to buy, so there is no page offering it — not a page saying
  // "upgrade", and not a nav link to one.
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Billing' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Admin' })).toBeHidden();

  expect((await page.request.get('/settings/billing')).status()).toBe(404);
  expect((await page.request.get('/admin')).status()).toBe(404);

  // And the team page says so, rather than showing a seat meter with a limit in it.
  await page.goto('/settings/team');
  await expect(page.getByText('No seat limit on a self-hosted install.')).toBeVisible();
});
