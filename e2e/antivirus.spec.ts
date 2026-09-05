import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { sql } from './mailbox';
import { addClient, buildChecklist, issuePortalLink, newRequest, signUpOwner } from './session';

/**
 * Phase 6 acceptance ④: an infected upload is quarantined and never downloadable.
 *
 * Needs the opt-in ClamAV profile, so it is a separate spec and a separate CI job:
 *
 *   docker compose -f docker-compose.yml -f docker-compose.antivirus.yml \
 *                  -f docker-compose.test.yml up -d --build
 *   pnpm test:antivirus
 *
 * The scanner is real clamd with a real signature database, and the file is the real
 * EICAR string — the 68-byte test file every antivirus engine is required to detect. It
 * is not a virus and can do nothing; it exists precisely so this can be tested without
 * anyone handling a live sample. It is generated at test time rather than committed, so
 * that nobody's own antivirus quarantines a file inside their clone of Gather.
 */

test.describe.configure({ timeout: 300_000 });

const ROOT = new URL('..', import.meta.url).pathname;

const ITEMS = [{ type: 'File upload', label: 'Bank statement' }];

function eicar(): Buffer {
  const path = join(tmpdir(), 'gather-eicar.com');
  execFileSync('sh', [join(ROOT, 'e2e/fixtures/make-eicar.sh'), path]);
  const bytes = readFileSync(path);
  expect(bytes.length, 'the EICAR string was mangled').toBe(68);
  return bytes;
}

test('④ an infected upload is quarantined, deleted, and never downloadable', async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const firmPage = await context.newPage();

  await signUpOwner(firmPage, 'eicar');
  await addClient(firmPage, 'Rosa Delgado');
  const requestId = await newRequest(firmPage, 'Infected upload');
  await buildChecklist(firmPage, 'What we need', ITEMS);
  const link = await issuePortalLink(firmPage, requestId);

  // ── A clean file first, to prove the scanner is actually running ───────────
  // Without this, a broken scanner that marked everything infected would pass the test
  // below and look like a working defence.
  await page.goto(link);
  const item = page.getByTestId('portal-item').filter({ hasText: 'Bank statement' });
  await item.getByLabel('Add a file for Bank statement').setInputFiles({
    name: 'statement.pdf',
    mimeType: 'application/pdf',
    buffer: readFileSync(join(ROOT, 'e2e/fixtures/irs-form-w9.pdf')),
  });
  await expect(item.getByTestId('uploaded-file')).toHaveCount(1, { timeout: 120_000 });

  expect(
    scanStatuses(requestId),
    'a clean file was not marked clean — is clamd actually scanning?',
  ).toEqual(['clean']);

  // ── The layer before the scanner ───────────────────────────────────────────
  // EICAR is conventionally `eicar.com`, and `.com` is a blocked extension — so it never
  // reaches clamd at all. Worth asserting: the scanner is the last line, not the first.
  const blockedByName = await page.request.post(
    `/portal/${requestId}/upload?item=${itemId(requestId)}`,
    {
      headers: { 'x-gather-filename': 'invoice.com', 'content-type': 'application/octet-stream' },
      data: eicar(),
      timeout: 120_000,
    },
  );
  expect(blockedByName.status()).toBe(415);
  expect(await blockedByName.text()).toMatch(/does not accept \.com/);

  // ── Now past that layer, so clamd is the thing being tested ───────────────
  // Named `.txt`, which Gather accepts on its extension alone because a text file has no
  // signature to check. Everything about it that is dangerous is in the bytes, which is
  // exactly the case the scanner exists for.
  const response = await page.request.post(
    `/portal/${requestId}/upload?item=${itemId(requestId)}`,
    {
      headers: {
        'x-gather-filename': 'statement.txt',
        'content-type': 'application/octet-stream',
      },
      data: eicar(),
      timeout: 120_000,
    },
  );

  // The client is told, rather than left thinking their document went through.
  expect(response.status()).toBe(422);
  expect(await response.text()).toMatch(/contains malware/i);

  // ── The row survives as evidence; the bytes do not ─────────────────────────
  const infected = sql(
    `select f.id, f.scan_status, f.storage_key, f.original_name from file f
       join response r on r.id = f.response_id
       join item i on i.id = r.item_id
       join section s on s.id = i.section_id
      where s.request_id = '${requestId}' and f.scan_status = 'infected'`,
  )
    .split('\n')[0]!
    .trim();

  expect(infected, 'no infected row was recorded').not.toBe('');
  const [fileId, status, storageKey, originalName] = infected.split('|');
  expect(status).toBe('infected');
  expect(originalName).toBe('statement.txt');
  // Quarantine is not disposal: the key still names where the object was, so the record
  // says "this file existed, here, and was found to be malware" rather than "this file was
  // routinely deleted". `purged:…` is what the retention job writes.
  expect(storageKey).toContain(requestId);
  expect(storageKey).not.toContain('purged:');

  // The object is gone from storage. A quarantine that keeps a live copy of a virus on the
  // firm's server is a worse answer than one that does not.
  const onDisk = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.antivirus.yml',
      'exec',
      '-T',
      'web',
      'sh',
      '-lc',
      `ls /app/data/uploads/${requestId}/ 2>/dev/null || true`,
    ],
    { encoding: 'utf8', cwd: ROOT },
  );
  expect(onDisk, 'the infected file is still on disk').not.toContain(fileId);

  // ── Undownloadable, to the firm as well as the client ─────────────────────
  await firmPage.goto(`/requests/${requestId}`);
  const refused = await firmPage.request.get(
    `/api/file/${fileId}?request=${requestId}&exp=99999999999&sig=x`,
  );
  // 403 either way — the signature check refuses first, and the quarantine check would
  // refuse next. Both are correct; what matters is that nothing hands the file over.
  expect(refused.status()).toBe(403);

  // ── And it is in the audit trail, with the signature name ─────────────────
  const events = sql(
    `select action, metadata->>'signature' from audit_event
      where request_id = '${requestId}' and action = 'file.quarantined'`,
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  expect(events).toHaveLength(1);
  expect(events[0]).toContain('file.quarantined');
  // ClamAV's own name for it, so a firm can look it up rather than take our word.
  expect(events[0]!.toLowerCase()).toContain('eicar');

  // The firm sees it on the request, in words — and is not offered a download button that
  // would only ever fail.
  await firmPage.reload();
  const row = firmPage.getByTestId('review-file').filter({ hasText: 'statement.txt' });
  await expect(row).toContainText('Infected — quarantined');
  await expect(row).toContainText('Not available');
  await expect(row.getByRole('button', { name: /^Download/ })).toHaveCount(0);

  // …and the zip does not quietly carry it past the single-file refusal.
  const zip = await firmPage.request.get(`/requests/${requestId}/download`);
  expect(zip.status()).toBe(200);
  const listing = Buffer.from(await zip.body()).toString('latin1');
  expect(listing, 'a quarantined file was in the archive').not.toContain('statement.txt');
  expect(listing).toContain('statement.pdf');

  await firmPage.close();
  await context.close();
});

function scanStatuses(requestId: string): string[] {
  return sql(
    `select f.scan_status from file f
       join response r on r.id = f.response_id
       join item i on i.id = r.item_id
       join section s on s.id = i.section_id
      where s.request_id = '${requestId}' order by f.uploaded_at`,
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function itemId(requestId: string): string {
  return sql(
    `select i.id from item i join section s on s.id = i.section_id
      where s.request_id = '${requestId}' and i.type = 'file' limit 1`,
  )
    .split('\n')[0]!
    .trim();
}
