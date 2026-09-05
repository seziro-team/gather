import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectNoMoreMail, inboxFor, readMessage, sql, waitForMail } from './mailbox';
import { addClient, buildChecklist, issuePortalLink, newRequest, signUpOwner } from './session';

/**
 * Phase 5's acceptance criteria: the firm closes the loop.
 *
 * The mechanic under test is the one plan.md §2.4 argues the whole product turns on —
 * "complete" is the firm's judgement, item by item, and never inferred from a file
 * existing. So these tests care about what the *client* sees after a decision as much as
 * what the firm sees making it.
 */

// A full sign-up and TOTP enrolment, then two devices, an upload and a zip.
test.describe.configure({ timeout: 240_000 });

const ROOT = new URL('..', import.meta.url).pathname;

const PDF = new URL('./fixtures/irs-form-w9.pdf', import.meta.url);

const ITEMS = [
  { type: 'File upload', label: 'Form W-9' },
  { type: 'File upload', label: 'Bank statement' },
  { type: 'Short text', label: 'Best phone number' },
  { type: 'Yes / no', label: 'Any foreign accounts?' },
  { type: 'Long text', label: 'Anything unusual this year?' },
];

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface Setup {
  requestId: string;
  clientEmail: string;
  portalLink: string;
  clientPage: Page;
}

/**
 * A firm, a client, and a request the client has filled in completely and sent back.
 *
 * Everything after this is the firm's half, which is what Phase 5 is about.
 */
async function requestSentBack(page: Page, browser: Browser, prefix: string): Promise<Setup> {
  await signUpOwner(page, prefix);
  const clientEmail = await addClient(page, 'Rosa Delgado');
  const requestId = await newRequest(page, 'Year-end documents');
  await buildChecklist(page, 'What we need', ITEMS);
  const portalLink = await issuePortalLink(page, requestId);

  const context = await browser.newContext();
  const clientPage = await context.newPage();
  await clientPage.goto(portalLink);

  const pdf = readFileSync(PDF);
  for (const label of ['Form W-9', 'Bank statement']) {
    const item = clientPage.getByTestId('portal-item').filter({ hasText: label });
    await item.getByLabel(`Add a file for ${label}`).setInputFiles({
      name: `${label.toLowerCase().replace(/\W+/g, '-')}.pdf`,
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await expect(item.getByTestId('uploaded-file')).toHaveCount(1, { timeout: 45_000 });
  }

  await clientPage.getByLabel('Best phone number').fill('07700 900461');
  await clientPage
    .getByTestId('portal-item')
    .filter({ hasText: 'Any foreign accounts?' })
    .getByText('No', { exact: true })
    .click();
  await clientPage.getByLabel('Anything unusual this year?').fill('We sold the van in March.');

  await expect(clientPage.getByTestId('portal-progress')).toHaveText('5 of 5 done');
  await clientPage.getByTestId('portal-submit').click();
  await expect(clientPage.getByTestId('portal-submitted')).toBeVisible();

  return { requestId, clientEmail, portalLink, clientPage };
}

test('① rejecting one item of five reopens exactly that one, with the note the client reads', async ({
  page,
  browser,
}) => {
  const setup = await requestSentBack(page, browser, 'review');

  // The dashboard, first — with a request actually waiting.
  //
  // This is where a real firm starts their day, and for a while it 500'd in exactly this
  // state: `min(response.updated_at)` came back as a string, so "oldest outstanding" threw
  // on a Date method. The suite never noticed because nothing here had opened the dashboard
  // with a submitted request in it.
  await page.goto('/dashboard');
  await expect(page.getByText('1 waiting for your review')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Year-end documents' })).toBeVisible();
  await expect(page.getByText(/outstanding/)).toBeVisible();

  await page.goto(`/requests/${setup.requestId}`);
  await expect(page.getByTestId('review-progress')).toContainText('0 of 5 approved');

  const items = page.getByTestId('review-item');
  await expect(items).toHaveCount(5);

  // Approve four, send the fifth back.
  for (const label of [
    'Bank statement',
    'Best phone number',
    'Any foreign accounts?',
    'Anything unusual this year?',
  ]) {
    await items.filter({ hasText: label }).getByTestId('approve').click();
    await expect(items.filter({ hasText: label })).toHaveAttribute('data-status', 'approved');
  }

  const rejected = items.filter({ hasText: 'Form W-9' });
  await rejected.getByTestId('reject').click();
  await page
    .getByLabel(/^What needs fixing\?/)
    .fill('This is the 2023 copy — we need the one you signed this year.');
  await page.getByTestId('confirm-reject').click();

  await expect(rejected).toHaveAttribute('data-status', 'rejected');
  await expect(page.getByTestId('review-progress')).toContainText('4 of 5 approved');

  // ── What the client sees ───────────────────────────────────────────────────
  await setup.clientPage.reload();

  const clientItems = setup.clientPage.getByTestId('portal-item');
  await expect(clientItems.filter({ hasText: 'Form W-9' })).toHaveAttribute(
    'data-status',
    'rejected',
  );
  await expect(clientItems.filter({ hasText: 'Form W-9' })).toContainText(
    'This is the 2023 copy — we need the one you signed this year.',
  );

  // The other four are locked, not merely ticked: an approved item is finished, and
  // leaving it editable invites a client to change a document already filed.
  for (const label of ['Bank statement', 'Best phone number']) {
    const item = clientItems.filter({ hasText: label });
    await expect(item).toHaveAttribute('data-status', 'approved');
    await expect(item).toContainText('Approved');
  }
  await expect(
    clientItems.filter({ hasText: 'Best phone number' }).getByLabel('Best phone number'),
  ).toBeDisabled();
  await expect(
    clientItems.filter({ hasText: 'Bank statement' }).getByLabel(/^Add a file for/),
  ).toHaveCount(0);

  // Exactly one item is outstanding.
  await expect(setup.clientPage.getByTestId('portal-progress')).toHaveText('4 of 5 done');

  // And the client was told, by email, without anyone pressing "send reminder".
  const mail = await waitForMail(setup.clientEmail, 1);
  const opened = await readMessage(mail[0]!.id);
  expect(opened.subject).toBe('One thing left: Year-end documents');
  expect(opened.text).toContain('Form W-9');

  await setup.clientPage.close();
});

test('② a resubmission is version 2, and the superseded file is retained', async ({
  page,
  browser,
}) => {
  const setup = await requestSentBack(page, browser, 'version');

  await page.goto(`/requests/${setup.requestId}`);
  const item = page.getByTestId('review-item').filter({ hasText: 'Form W-9' });
  await item.getByTestId('reject').click();
  await page.getByLabel(/^What needs fixing\?/).fill('Wrong year.');
  await page.getByTestId('confirm-reject').click();
  await expect(item).toHaveAttribute('data-status', 'rejected');

  expect(versionOf(setup.requestId, 'Form W-9')).toBe(2);

  // The client sends a different file for the same item.
  await setup.clientPage.reload();
  const clientItem = setup.clientPage.getByTestId('portal-item').filter({ hasText: 'Form W-9' });
  await clientItem.getByLabel('Add a file for Form W-9').setInputFiles({
    name: 'form-w9-signed-2026.pdf',
    mimeType: 'application/pdf',
    buffer: readFileSync(PDF),
  });
  await expect(clientItem.getByTestId('uploaded-file')).toHaveCount(2, { timeout: 45_000 });

  // Both files are still there, on their own versions — the old one is not deleted, which
  // is the point of `file.response_version`.
  const versions = fileVersions(setup.requestId, 'Form W-9');
  expect(versions.sort()).toEqual([1, 2]);

  // The firm sees which is which.
  await page.reload();
  const files = page
    .getByTestId('review-item')
    .filter({ hasText: 'Form W-9' })
    .getByTestId('review-file');
  await expect(files).toHaveCount(2);
  await expect(files.filter({ hasText: 'form-w9-signed-2026.pdf' })).toHaveAttribute(
    'data-current',
    'yes',
  );
  await expect(files.filter({ hasText: 'form-w-9.pdf' })).toHaveAttribute('data-current', 'no');

  // …and the superseded upload is still in the audit trail, by name and by hash.
  const uploads = sql(
    `select count(*) from audit_event
      where request_id = '${setup.requestId}' and action = 'portal.file_uploaded'`,
  ).split('\n')[0];
  expect(Number(uploads)).toBe(3);

  await setup.clientPage.close();
});

test('③ approving the last required item completes the request and stops the reminders', async ({
  page,
  browser,
}) => {
  const setup = await requestSentBack(page, browser, 'complete');

  // Turn reminders on so there is something that has to stop.
  await page.goto(`/requests/${setup.requestId}`);
  await page.getByTestId('save-schedule').click();
  await expect(page.getByTestId('reminder-state')).toHaveText('Reminders on');

  const before = await inboxFor(setup.clientEmail);

  const items = page.getByTestId('review-item');
  const count = await items.count();
  for (let i = 0; i < count; i += 1) {
    await items.nth(i).getByTestId('approve').click();
    await expect(items.nth(i)).toHaveAttribute('data-status', 'approved');
  }

  await expect(page.getByText('the request is complete and reminders have stopped')).toBeVisible();

  expect(requestStatus(setup.requestId)).toBe('complete');
  expect(scheduleActive(setup.requestId)).toBe(false);

  // Nothing further goes out, even though a schedule existed a moment ago.
  await expectNoMoreMail(setup.clientEmail, before.length, 15_000);

  await setup.clientPage.close();
});

test('④ the zip holds the current files, foldered, with a manifest that matches', async ({
  page,
  browser,
}) => {
  const setup = await requestSentBack(page, browser, 'zip');
  const pdfHash = sha256(readFileSync(PDF));

  // Reject and resubmit, so there is a superseded version the default zip must leave out.
  await page.goto(`/requests/${setup.requestId}`);
  const item = page.getByTestId('review-item').filter({ hasText: 'Form W-9' });
  await item.getByTestId('reject').click();
  await page.getByLabel(/^What needs fixing\?/).fill('Wrong year.');
  await page.getByTestId('confirm-reject').click();

  await setup.clientPage.reload();
  await setup.clientPage
    .getByTestId('portal-item')
    .filter({ hasText: 'Form W-9' })
    .getByLabel('Add a file for Form W-9')
    .setInputFiles({
      name: 'form-w9-signed-2026.pdf',
      mimeType: 'application/pdf',
      buffer: readFileSync(PDF),
    });
  await expect(
    setup.clientPage
      .getByTestId('portal-item')
      .filter({ hasText: 'Form W-9' })
      .getByTestId('uploaded-file'),
  ).toHaveCount(2, { timeout: 45_000 });

  // ── Download it ────────────────────────────────────────────────────────────
  await page.reload();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-zip').click(),
  ]);

  const zipPath = join(tmpdir(), `gather-${setup.requestId}.zip`);
  await download.saveAs(zipPath);

  // Read with the system `unzip`, not a JavaScript library: what is being checked is that
  // a real extractor on somebody else's machine opens this file.
  const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8', cwd: ROOT });
  const tested = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8', cwd: ROOT });
  expect(tested).toContain('No errors detected');

  // Foldered by section and item, in checklist order.
  expect(listing).toMatch(/01 What we need\/01 Form W-9 - form-w9-signed-2026\.pdf/);
  expect(listing).toMatch(/01 What we need\/02 Bank statement - bank-statement\.pdf/);
  expect(listing).toContain('MANIFEST.txt');

  // The superseded copy is not in the default archive…
  expect(listing).not.toContain('form-w-9.pdf');

  // …and the manifest says so rather than staying quiet about it.
  const extractDir = join(tmpdir(), `gather-unzip-${setup.requestId}`);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', extractDir], { cwd: ROOT });
  const manifestPath = execFileSync('find', [extractDir, '-name', 'MANIFEST.txt'], {
    encoding: 'utf8',
  }).trim();
  const manifest = readFileSync(manifestPath, 'utf8');

  expect(manifest).toContain('Rosa Delgado');
  expect(manifest).toContain('Year-end documents');
  expect(manifest).toContain(pdfHash);
  expect(manifest).toContain('Not included (1)');

  // The extracted bytes are the bytes that were uploaded.
  // The entry basename carries its item prefix — `01 Form W-9 - form-w9-signed-2026.pdf` —
  // so this globs rather than matching the uploaded name exactly.
  const extracted = execFileSync('find', [extractDir, '-name', '*form-w9-signed-2026.pdf'], {
    encoding: 'utf8',
  })
    .split('\n')[0]!
    .trim();
  expect(extracted, 'the uploaded PDF is not in the extracted archive').not.toBe('');
  expect(sha256(readFileSync(extracted))).toBe(pdfHash);

  // And `?include=all` does contain the replaced version.
  const [everything] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-zip-all').click(),
  ]);
  const allPath = join(tmpdir(), `gather-all-${setup.requestId}.zip`);
  await everything.saveAs(allPath);
  const allListing = execFileSync('unzip', ['-l', allPath], { encoding: 'utf8', cwd: ROOT });
  expect(allListing).toContain('form-w-9.pdf');
  expect(allListing).toContain('form-w9-signed-2026.pdf');

  await setup.clientPage.close();
});

test('⑤ the audit CSV covers the lifecycle and verifies itself away from the database', async ({
  page,
  browser,
}) => {
  const setup = await requestSentBack(page, browser, 'audit');

  await page.goto(`/requests/${setup.requestId}`);
  const items = page.getByTestId('review-item');
  await items.first().getByTestId('reject').click();
  await page.getByLabel(/^What needs fixing\?/).fill('Wrong year.');
  await page.getByTestId('confirm-reject').click();
  await items.nth(1).getByTestId('approve').click();
  await expect(items.nth(1)).toHaveAttribute('data-status', 'approved');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-audit').click(),
  ]);
  const csvPath = join(tmpdir(), `gather-audit-${setup.requestId}.csv`);
  await download.saveAs(csvPath);

  const csv = readFileSync(csvPath, 'utf8');
  const header = csv.split('\r\n')[0]!;
  expect(header).toBe(
    'id,created_at,action,actor_type,actor_id,firm_id,request_id,target_type,target_id,metadata,ip,user_agent,prev_hash,hash',
  );

  // The whole lifecycle, in one file.
  for (const action of [
    'request.created',
    'request.structure_updated',
    'request.link_issued',
    'portal.opened',
    'portal.file_uploaded',
    'portal.submitted',
    'response.rejected',
    'response.approved',
  ]) {
    expect(csv, `${action} missing from the export`).toContain(action);
  }
  // The note the client was given is in the record, not just on a screen.
  expect(csv).toContain('Wrong year.');

  // ── The part that makes it evidence ────────────────────────────────────────
  // Verified from the file alone, by the shipped CLI, with no database involved.
  const verified = execFileSync('pnpm', ['verify:audit', '--csv', csvPath], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: '' },
  });
  expect(verified).toMatch(/every row's hash recomputes/);
  // A request-scoped export is a subset, and the tool says so rather than overclaiming.
  expect(verified).toMatch(/filtered export/);

  // Change one byte of one row and it fails.
  const tamperedPath = join(tmpdir(), `gather-audit-tampered-${setup.requestId}.csv`);
  writeFileSync(tamperedPath, csv.replace('Wrong year.', 'Right year.'));

  let failed: string;
  try {
    execFileSync('pnpm', ['verify:audit', '--csv', tamperedPath], {
      encoding: 'utf8',
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: '' },
      stdio: 'pipe',
    });
    throw new Error('verify:audit accepted a tampered export');
  } catch (error) {
    failed = String((error as { stderr?: Buffer }).stderr ?? '');
  }
  expect(failed).toMatch(/content was modified/);

  await setup.clientPage.close();
});

function versionOf(requestId: string, label: string): number {
  return Number(
    sql(
      `select r.version from response r
         join item i on i.id = r.item_id
         join section s on s.id = i.section_id
        where s.request_id = '${requestId}' and i.label = '${label}'`,
    ).split('\n')[0],
  );
}

function fileVersions(requestId: string, label: string): number[] {
  return sql(
    `select f.response_version from file f
       join response r on r.id = f.response_id
       join item i on i.id = r.item_id
       join section s on s.id = i.section_id
      where s.request_id = '${requestId}' and i.label = '${label}'`,
  )
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function requestStatus(requestId: string): string {
  return sql(`select status from request where id = '${requestId}'`).split('\n')[0]!.trim();
}

function scheduleActive(requestId: string): boolean {
  const row = sql(`select active from reminder_schedule where request_id = '${requestId}'`)
    .split('\n')[0]!
    .trim();
  return row === 't';
}
