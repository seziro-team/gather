import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { addClient, buildChecklist, issuePortalLink, newRequest, signUpOwner } from './session';

/**
 * Phase 3's acceptance criteria, on the device the client actually holds.
 *
 * This file runs under the `mobile-safari` project — WebKit at 390×844, with touch and an
 * iOS user agent. plan.md §2.4 is a column of practitioners describing client-side friction
 * as the thing that kills document portals, so "it works on a phone" is a criterion here
 * rather than a hope.
 *
 * The firm's half of each test runs in its own desktop context. Two people, two devices,
 * one request — which is the actual shape of the product.
 */

const FIXTURES = new URL('./fixtures/', import.meta.url);

/** The real IRS Form W-9, 6 pages. Provenance in e2e/fixtures/README.md. */
const PDF = new URL('irs-form-w9.pdf', FIXTURES);
/** A 3024×4032 JPEG carrying camera EXIF, as a phone's camera roll would hand it over. */
const PHOTO = new URL('receipt-photo.jpg', FIXTURES);

interface Fixture {
  name: string;
  bytes: Buffer;
  sha256: string;
  mimeType: string;
}

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixture(url: URL): Fixture {
  const bytes = readFileSync(url);
  const name = url.pathname.split('/').pop()!;
  return {
    name,
    bytes,
    sha256: sha256(bytes),
    mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
  };
}

const ITEMS = [
  { type: 'File upload', label: 'Your W-9' },
  { type: 'File upload', label: 'A photo of the receipt' },
  { type: 'Short text', label: 'Best phone number to reach you on' },
  { type: 'Long text', label: 'Anything unusual this year?' },
];

interface FirmSide {
  /** The firm's own browser tab, still signed in. */
  page: Page;
  requestId: string;
  link: string;
  close: () => Promise<void>;
}

/** A firm, a client and a request — set up on a laptop, returning the link and the tab. */
async function firmSetsUpRequest(
  browser: Browser,
  prefix: string,
  title: string,
): Promise<FirmSide> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();

  await signUpOwner(page, prefix);
  await addClient(page, 'Rosa Delgado');
  const requestId = await newRequest(page, title);
  await buildChecklist(page, 'What we need from you', ITEMS);
  const link = await issuePortalLink(page, requestId);

  return { page, requestId, link, close: () => context.close() };
}

/** Uploads a fixture into a named item and waits for the row to appear. Returns its id. */
async function uploadInto(page: Page, label: string, file: Fixture): Promise<string> {
  const item = page.getByTestId('portal-item').filter({ hasText: label });
  await item.getByLabel(`Add a file for ${label}`).setInputFiles({
    name: file.name,
    mimeType: file.mimeType,
    buffer: file.bytes,
  });

  const row = item.getByTestId('uploaded-file');
  await expect(row).toHaveCount(1, { timeout: 45_000 });
  await expect(row).toContainText(file.name);
  await expect(item).toHaveAttribute('data-answered', 'yes');

  const id = await row.first().getAttribute('data-file-id');
  if (!id) throw new Error(`No data-file-id on the uploaded row for "${label}"`);
  return id;
}

/**
 * Clicks a Download button and returns the URL the server minted.
 *
 * Going through the button means the signature and its five-minute expiry come from the
 * real server action rather than from a copy of the signing logic in the test.
 *
 * Waiting on the *download* event rather than on a network request is deliberate twice
 * over: it is what the browser actually does with a `Content-Disposition: attachment`
 * response — so the wait doubles as proof that the header works — and a download is
 * handled by the browser's download machinery rather than as a page navigation, which is
 * why watching for a request never fires.
 */
async function mintedDownloadUrl(page: Page, row: Locator): Promise<string> {
  // The portal's button is named by its text ("Download"); the firm's carries an
  // aria-label naming the file ("Download irs-form-w9.pdf"). A prefix match takes both.
  const button = row.getByRole('button', { name: /^Download/ });
  await expect(button, 'no Download button in this row').toHaveCount(1);

  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const url = download.url();
  // Two shapes, one signing path: the portal's `/portal/<req>/file/<id>?exp=…` and the
  // firm's `/api/file/<id>?request=<req>&exp=…`.
  expect(url).toMatch(/\/file\/[0-9a-f-]{36}\?(?:request=[0-9a-f-]{36}&)?exp=\d+&sig=/);
  await download.delete();
  return url;
}

/** Nothing may stick out sideways — the single most common way a mobile page fails. */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(
    box.scroll,
    `the page is ${box.scroll - box.client}px wider than the screen`,
  ).toBeLessThanOrEqual(box.client);
}

test('① a client uploads a real PDF and a phone photo, on a phone, with no account', async ({
  page,
  browser,
}, testInfo) => {
  const firm = await firmSetsUpRequest(browser, 'portal', 'Year-end documents');
  const pdf = fixture(PDF);
  const photo = fixture(PHOTO);

  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });

  // The client's entire experience: they tap a link.
  await page.goto(firm.link);
  await expect(page).toHaveURL(new RegExp(`/portal/${firm.requestId}$`));
  await expect(page.getByRole('heading', { name: 'Year-end documents' })).toBeVisible();
  await expect(page.getByTestId('portal-progress')).toHaveText('0 of 4 done');

  // No account, anywhere: no password field, and nothing offering to make one.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /sign in|sign up|log in/i })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  const pdfFileId = await uploadInto(page, 'Your W-9', pdf);
  await uploadInto(page, 'A photo of the receipt', photo);

  await expect(page.getByTestId('portal-progress')).toHaveText('2 of 4 done');
  await expectNoHorizontalScroll(page);

  // No pinching to hit things: every control a finger actually lands on clears Apple's
  // own 44px floor. A client who has to zoom is a client who phones the firm instead.
  //
  // `.sr-only` is excluded deliberately rather than by accident. The file input is a 1px
  // clipped element by design — nobody taps it; they tap its label, which is in this list
  // and is 44px. Asserting on the input would be asserting about the wrong element.
  const tappable = page.locator('button:not(.sr-only), label[for]:not(.sr-only)');
  const count = await tappable.count();
  expect(count, 'no tappable controls found — the selector is wrong').toBeGreaterThan(3);

  for (let index = 0; index < count; index += 1) {
    const control = tappable.nth(index);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (box) expect(box.height, (await control.innerText()).trim()).toBeGreaterThanOrEqual(44);
  }

  // ── ③ What comes back out is byte-identical to what went in ────────────────
  // Through the real signed-URL path. That the bytes *at rest* are not a PDF is checked
  // separately, from outside the app, in the Phase 3 demo script.
  const url = await mintedDownloadUrl(page, page.locator(`[data-file-id="${pdfFileId}"]`));
  expect(url).toContain(pdfFileId);

  const download = await page.request.get(url);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-disposition']).toContain('attachment');
  expect(download.headers()['x-content-type-options']).toBe('nosniff');
  expect(download.headers()['content-security-policy']).toContain("default-src 'none'");

  const returned = Buffer.from(await download.body());
  expect(returned.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(sha256(returned), 'the PDF that came back is not the PDF that went in').toBe(pdf.sha256);

  // The firm sees the same hash on its side, which is what makes it a chain of custody.
  await firm.page.goto(`/requests/${firm.requestId}`);
  await expect(
    firm.page.getByTestId('review-file').filter({ hasText: pdf.name }).first(),
  ).toContainText(pdf.sha256.slice(0, 10));

  await testInfo.attach('portal-on-a-phone.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  await firm.close();
});

test('② an answer typed and abandoned mid-way survives the tab being closed', async ({
  page,
  browser,
  context,
}) => {
  const firm = await firmSetsUpRequest(browser, 'autosave', 'Autosave check');
  const PHONE = '07700 900461';
  const NOTE = 'We sold the van in March and I cannot find the paperwork';

  await page.goto(firm.link);
  await page.getByLabel('Best phone number to reach you on').fill(PHONE);

  // Waiting on the indicator rather than on a sleep: this tests that autosave happened,
  // not that 700ms is longer than 700ms.
  await expect(page.getByTestId('save-state').first()).toHaveText('Saved');

  // The tab dies. Not a reload and not a navigation — closed, the way a phone taking a
  // call or a browser reclaiming memory closes it.
  await page.close();

  // Same browser, same cookie jar, same link: exactly what the next reminder email opens.
  const returning = await context.newPage();
  await returning.goto(`/portal/${firm.requestId}`);
  await expect(returning.getByLabel('Best phone number to reach you on')).toHaveValue(PHONE);
  await expect(returning.getByTestId('portal-progress')).toHaveText('1 of 4 done');

  // A long answer that is never blurred — the case a save-on-blur design loses outright.
  const notes = returning.getByLabel('Anything unusual this year?');
  await notes.click();
  await notes.pressSequentially(NOTE, { delay: 10 });
  await expect(returning.getByTestId('save-state').first()).toHaveText('Saved');
  await returning.close();

  const third = await context.newPage();
  await third.goto(`/portal/${firm.requestId}`);
  await expect(third.getByLabel('Anything unusual this year?')).toHaveValue(NOTE);
  await expect(third.getByTestId('portal-progress')).toHaveText('2 of 4 done');
  await third.close();

  await firm.close();
});

test('⑤ nothing scoped to one request can reach another request’s file', async ({
  page,
  browser,
}) => {
  const pdf = fixture(PDF);

  // One firm, two requests. Same firm on purpose: a signature minted in the firm's own
  // scope is valid for any file id, so the only thing standing between request A and
  // request B's documents is the database join. That is what this test attacks.
  const firm = await firmSetsUpRequest(browser, 'idor', 'Request A');
  const secondId = await newRequest(firm.page, 'Request B');
  await buildChecklist(firm.page, 'What we need from you', ITEMS);
  const secondLink = await issuePortalLink(firm.page, secondId);

  // B's client uploads a document.
  const victimContext = await browser.newContext();
  const victim = await victimContext.newPage();
  await victim.goto(secondLink);
  const victimFileId = await uploadInto(victim, 'Your W-9', pdf);

  // A's client opens their own link and gets a working session.
  await page.goto(firm.link);
  await expect(page.getByTestId('portal-progress')).toBeVisible();

  // ── The portal session is scoped to one request ────────────────────────────
  // A's cookie is set with path=/portal/<A>, so it is never even sent to B's page.
  const onBsPage = await page.request.get(`/portal/${secondId}`, { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(onBsPage.status());
  expect(onBsPage.headers()['location']).toContain('/portal/unavailable');

  // ── A's session cannot upload into B's request ─────────────────────────────
  const crossUpload = await page.request.post(`/portal/${secondId}/upload?item=${victimFileId}`, {
    headers: { 'x-gather-filename': 'anything.pdf', 'content-type': 'application/octet-stream' },
    data: pdf.bytes,
  });
  expect(crossUpload.status()).toBe(401);

  // ── An unsigned request for a file is refused before any lookup happens ────
  const unsigned = await page.request.get(
    `/portal/${firm.requestId}/file/${victimFileId}?exp=99999999999&sig=not-a-signature`,
  );
  expect(unsigned.status()).toBe(403);

  // ── The real attack: a genuinely valid signature, pointed at the wrong request ──
  // The firm mints a download link for B's file from B's own page. The signature is
  // scoped to the firm, so it verifies against request A too — and A's route still has
  // to refuse, because the file → response → item → section → request join finds nothing.
  await firm.page.goto(`/requests/${secondId}`);
  const firmRow = firm.page.getByTestId('review-file').filter({ hasText: pdf.name }).first();
  const legitimate = await mintedDownloadUrl(firm.page, firmRow);
  expect(legitimate).toContain(victimFileId);

  // It works where it is supposed to.
  const allowed = await firm.page.request.get(legitimate);
  expect(allowed.status()).toBe(200);
  expect(sha256(Buffer.from(await allowed.body()))).toBe(pdf.sha256);

  // And returns 404 — not 403, no hint the id exists — when aimed at request A.
  const swapped = legitimate.replace(`request=${secondId}`, `request=${firm.requestId}`);
  expect(swapped, 'the request id did not change; the assertion below would be vacuous').not.toBe(
    legitimate,
  );
  const denied = await firm.page.request.get(swapped);
  expect(denied.status(), 'a valid signature reached another request’s file').toBe(404);

  await victim.close();
  await victimContext.close();
  await firm.close();
});
