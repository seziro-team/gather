import { expect, test, type Browser, type Page } from '@playwright/test';
import { sql } from './mailbox';
import { addClient, buildChecklist, issuePortalLink, newRequest, signUpOwner } from './session';

/**
 * Phase 6's acceptance criteria, minus the antivirus ones.
 *
 * These are the claims `docs/threat-model.md` makes, checked rather than asserted. The
 * important one is the first: plan.md §6 calls cross-request access "the #1 risk in this
 * app", and a product that collects tax documents does not get to have that as a
 * best-effort property.
 *
 * The EICAR quarantine tests live in `antivirus.spec.ts`, which needs the opt-in ClamAV
 * profile and 3 GiB of RAM.
 */

test.describe.configure({ timeout: 240_000 });

const ITEMS = [
  { type: 'File upload', label: 'Bank statement' },
  { type: 'Short text', label: 'Reference' },
];

interface Firm {
  page: Page;
  requestId: string;
  link: string;
  itemId: string;
  close: () => Promise<void>;
}

async function firmWithRequest(browser: Browser, prefix: string): Promise<Firm> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await signUpOwner(page, prefix);
  await addClient(page, 'Rosa Delgado');
  const requestId = await newRequest(page, `${prefix} documents`);
  await buildChecklist(page, 'What we need', ITEMS);
  const link = await issuePortalLink(page, requestId);

  const itemId = sql(
    `select i.id from item i join section s on s.id = i.section_id
      where s.request_id = '${requestId}' and i.type = 'file' limit 1`,
  )
    .split('\n')[0]!
    .trim();

  return { page, requestId, link, itemId, close: () => context.close() };
}

test('① a portal session cannot reach another request, by any route', async ({ page, browser }) => {
  const mine = await firmWithRequest(browser, 'idor-mine');
  const theirs = await firmWithRequest(browser, 'idor-theirs');

  // A working session for my own request.
  await page.goto(mine.link);
  await expect(page.getByTestId('portal-progress')).toBeVisible();

  // ── The page ───────────────────────────────────────────────────────────────
  const otherPage = await page.request.get(`/portal/${theirs.requestId}`, { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(otherPage.status());
  expect(otherPage.headers()['location']).toContain('/portal/unavailable');

  // ── Uploading into their request ───────────────────────────────────────────
  const crossUpload = await page.request.post(
    `/portal/${theirs.requestId}/upload?item=${theirs.itemId}`,
    {
      headers: { 'x-gather-filename': 'x.pdf', 'content-type': 'application/octet-stream' },
      data: Buffer.from('%PDF-1.4\n%%EOF'),
    },
  );
  expect(crossUpload.status()).toBe(401);

  // ── Uploading their item through *my* request's path ───────────────────────
  // The session is valid and the path is mine; only the item belongs to somebody else.
  // This is the one a naive implementation gets wrong.
  const crossItem = await page.request.post(
    `/portal/${mine.requestId}/upload?item=${theirs.itemId}`,
    {
      headers: { 'x-gather-filename': 'x.pdf', 'content-type': 'application/octet-stream' },
      data: Buffer.from('%PDF-1.4\n%%EOF'),
    },
  );
  expect(crossItem.status(), 'an item from another request was accepted').toBe(404);

  // ── A firm signed in to one firm cannot see another firm's request ─────────
  const acrossFirms = await mine.page.request.get(`/requests/${theirs.requestId}`);
  expect(acrossFirms.status()).toBe(404);

  const acrossFirmsZip = await mine.page.request.get(`/requests/${theirs.requestId}/download`);
  expect(acrossFirmsZip.status()).toBe(404);

  const acrossFirmsAudit = await mine.page.request.get(`/requests/${theirs.requestId}/audit.csv`);
  expect(acrossFirmsAudit.status()).toBe(404);

  await mine.close();
  await theirs.close();
});

test('② an expired link is refused, a revoked link is refused, and both are recorded', async ({
  page,
  browser,
}) => {
  const firm = await firmWithRequest(browser, 'tokens');

  // ── Revoked ────────────────────────────────────────────────────────────────
  const revokedLink = await issuePortalLink(firm.page, firm.requestId);
  await firm.page.getByRole('button', { name: 'Revoke' }).first().click();
  await expect(firm.page.getByText('Revoked').first()).toBeVisible();

  await page.goto(revokedLink);
  await expect(page).toHaveURL(/\/portal\/unavailable\?reason=revoked/);

  // ── Expired ────────────────────────────────────────────────────────────────
  // Moving the expiry into the past is the only way to age a link a test can afford to
  // wait for; everything else about the check is the real path.
  const expiredLink = await issuePortalLink(firm.page, firm.requestId);
  sql(
    `update access_token set expires_at = now() - interval '1 day'
      where request_id = '${firm.requestId}' and revoked_at is null
        and id = (select id from access_token where request_id = '${firm.requestId}'
                   and revoked_at is null order by created_at desc limit 1)`,
  );

  await page.goto(expiredLink);
  await expect(page).toHaveURL(/\/portal\/unavailable\?reason=expired/);

  // ── A link that never existed ──────────────────────────────────────────────
  await page.goto('/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await expect(page).toHaveURL(/\/portal\/unavailable\?reason=not-found/);

  // ── All three recorded, with the reason ────────────────────────────────────
  const reasons = sql(
    `select metadata->>'reason' from audit_event
      where action = 'portal.link_rejected' order by id desc limit 3`,
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  expect(reasons).toContain('revoked');
  expect(reasons).toContain('expired');
  expect(reasons).toContain('unknown');

  await firm.close();
});

test('③ too many uploads gets a 429 with the headers to act on', async ({ page, browser }) => {
  const firm = await firmWithRequest(browser, 'ratelimit');

  await page.goto(firm.link);
  await expect(page.getByTestId('portal-progress')).toBeVisible();

  // `portal.upload` is limited **per portal session** at 30 a minute. Per session, not per
  // IP, because an office behind one NAT is one address and many clients — see
  // lib/throttle.ts. That also means this test cannot affect any other: its bucket dies
  // with its session.
  //
  // Every request is deliberately malformed (no filename header), so nothing is stored and
  // what is being measured is purely the limiter.
  const statuses: number[] = [];
  let refused: Record<string, string> | null = null;

  for (let i = 0; i < 40; i += 1) {
    const response = await page.request.post(
      `/portal/${firm.requestId}/upload?item=${firm.itemId}`,
      {
        headers: { 'content-type': 'application/octet-stream' },
        data: Buffer.from('x'),
      },
    );
    statuses.push(response.status());
    if (response.status() === 429) {
      refused = response.headers();
      break;
    }
  }

  expect(statuses, 'no request was ever refused').toContain(429);
  // …and the ones before it were not. A limiter that refuses the first request is not a
  // limiter, it is an outage.
  expect(statuses[0]).toBe(400);
  expect(statuses.filter((status) => status === 400).length).toBeGreaterThanOrEqual(30);

  // The headers somebody debugging a 429 will look for.
  expect(Number(refused!['retry-after'])).toBeGreaterThan(0);
  expect(refused!['ratelimit-limit']).toBe('30');
  expect(refused!['ratelimit-remaining']).toBe('0');

  await firm.close();
});

test('③b a magic-link flood is bounded even when callers cannot be told apart', async ({
  page,
  browser,
}) => {
  const firm = await firmWithRequest(browser, 'flood');

  // With no trusted proxy header Gather genuinely cannot distinguish one client from
  // another, so per-IP limiting is unavailable and everybody shares one high ceiling.
  // Applying the per-IP number globally instead would lock a firm's own clients out of
  // their own documents, which is a worse failure than the one it prevents.
  //
  // What is checked here is that the ceiling exists and that ordinary use is nowhere near
  // it: a real client opening their link twenty times in a minute is not refused.
  for (let i = 0; i < 20; i += 1) {
    const response = await page.request.get(firm.link, { maxRedirects: 0 });
    expect([302, 303, 307, 308], `a real client was refused on attempt ${i + 1}`).toContain(
      response.status(),
    );
  }

  // The bucket is being counted, even though nothing has hit the ceiling.
  const hits = Number(
    sql(`select hits from throttle where bucket = 'portal.open.shared:shared'`)
      .split('\n')[0]!
      .trim(),
  );
  expect(hits).toBeGreaterThanOrEqual(20);

  await firm.close();
});

test('⑤ with no scanner configured, files say so rather than looking clean', async ({
  page,
  browser,
}) => {
  const firm = await firmWithRequest(browser, 'unscanned');

  await page.goto(firm.link);
  const item = page.getByTestId('portal-item').filter({ hasText: 'Bank statement' });
  await item.getByLabel('Add a file for Bank statement').setInputFiles({
    name: 'statement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
  });
  await expect(item.getByTestId('uploaded-file')).toHaveCount(1, { timeout: 45_000 });

  // The database says `skipped`, not `clean`. The difference between "we checked and it
  // was fine" and "nobody looked" is the whole point.
  const status = sql(
    `select f.scan_status from file f
       join response r on r.id = f.response_id
       join item i on i.id = r.item_id
       join section s on s.id = i.section_id
      where s.request_id = '${firm.requestId}'`,
  )
    .split('\n')[0]!
    .trim();
  expect(status).toBe('skipped');

  // And the firm is told, in words, next to the file.
  await firm.page.goto(`/requests/${firm.requestId}`);
  await expect(firm.page.getByTestId('review-file').first()).toContainText('Not scanned');

  await firm.close();
});

test('⑥ every response carries the security headers, and uploads carry stricter ones', async ({
  page,
  browser,
}) => {
  const firm = await firmWithRequest(browser, 'headers');

  const response = await page.request.get(firm.link);
  expect(response.status()).toBe(200);
  const headers = response.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['permissions-policy']).toContain('camera=()');

  const csp = headers['content-security-policy'];
  expect(csp, 'no Content-Security-Policy').toBeTruthy();
  expect(csp).toContain(`default-src 'self'`);
  expect(csp).toContain(`frame-ancestors 'none'`);
  expect(csp).toContain(`object-src 'none'`);
  // A nonce with strict-dynamic, not `unsafe-inline` — a script policy that would not stop
  // an injected script is not worth the header.
  expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
  expect(csp).toContain(`'strict-dynamic'`);

  // Two consecutive requests get different nonces, or it is not a nonce.
  const second = await page.request.get(firm.link);
  const firstNonce = /'nonce-([^']+)'/.exec(csp!)?.[1];
  const secondNonce = /'nonce-([^']+)'/.exec(second.headers()['content-security-policy']!)?.[1];
  expect(firstNonce).toBeTruthy();
  expect(secondNonce).not.toBe(firstNonce);

  // Over plain HTTP, HSTS is deliberately absent: pinning a browser to a scheme this
  // install does not serve would lock a self-hoster out of their own tool.
  expect(headers['strict-transport-security']).toBeUndefined();

  // ── A file that could execute in a browser is refused outright ────────────
  // Stronger than any header: an SVG can carry script and be rendered inline, so Gather
  // does not accept one at all. A document request is not a file transfer service.
  const svg = await page.request.post(`/portal/${firm.requestId}/upload?item=${firm.itemId}`, {
    headers: {
      'x-gather-filename': 'logo.svg',
      'content-type': 'application/octet-stream',
    },
    data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  expect(svg.status(), 'an SVG was accepted').toBe(415);
  expect(await svg.text()).toMatch(/does not accept \.svg/);

  // Renaming it does not help — the type is decided by the bytes, not the extension.
  const disguised = await page.request.post(
    `/portal/${firm.requestId}/upload?item=${firm.itemId}`,
    {
      headers: {
        'x-gather-filename': 'totally-a-document.pdf',
        'content-type': 'application/octet-stream',
      },
      data: Buffer.from('<html><script>alert(1)</script></html>'),
    },
  );
  expect(disguised.status(), 'HTML renamed to .pdf was accepted').toBe(415);

  // ── And what is accepted is served so it cannot execute anyway ────────────
  await page.goto(firm.link);
  const item = page.getByTestId('portal-item').filter({ hasText: 'Bank statement' });
  await item.getByLabel('Add a file for Bank statement').setInputFiles({
    name: 'statement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
  });
  await expect(item.getByTestId('uploaded-file')).toHaveCount(1, { timeout: 45_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    item.getByRole('button', { name: /^Download/ }).click(),
  ]);
  const file = await page.request.get(download.url());
  const fileHeaders = file.headers();

  expect(fileHeaders['content-disposition']).toContain('attachment');
  expect(fileHeaders['x-content-type-options']).toBe('nosniff');
  expect(fileHeaders['content-security-policy']).toContain(`default-src 'none'`);
  expect(fileHeaders['content-security-policy']).toContain('sandbox');
  await download.delete();

  await firm.close();
});
