import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  expectNoMoreMail,
  inboxFor,
  makeReminderDue,
  readMessage,
  lastProviderMessageId,
  reminderLogCount,
  reminderStatus,
  auditActions,
  scheduleRow,
  simulateCrashedClaim,
  waitForMail,
} from './mailbox';
import { addClient, buildChecklist, newRequest, issuePortalLink, signUpOwner } from './session';

// Each of these drives a full sign-up and TOTP enrolment, then waits on a background
// worker and a real SMTP round trip. The default 60s is not a meaningful assertion about
// the product.
test.describe.configure({ timeout: 240_000 });

/**
 * Phase 4's acceptance criteria, against a real SMTP server.
 *
 * Every message asserted on here travelled over a real SMTP conversation into a real
 * inbox (Mailpit, from docker-compose.mail.yml) — Gather has no idea it is being tested
 * and takes exactly the path it takes in production.
 *
 * The one thing that is simulated is the passage of days: the shortest cadence Gather
 * offers is one day, and a test cannot wait for that. `makeReminderDue` moves a schedule's
 * `next_run_at` into the past, which is what tomorrow looks like to the worker. The scan,
 * the send-once claim, the SMTP send and the schedule advance are all real.
 *
 * ⚠️ Not proven here: Resend. plan.md §9's Phase 4 acceptance ① asks for real Resend
 * message ids, which needs an API key and a verified sending domain the operator has not
 * provided. The driver is written and unit-tested against the documented API; it has never
 * been run against the live service. Recorded as a hard stop in progress.md.
 */

const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.mail.yml'];
const ROOT = new URL('..', import.meta.url).pathname;

function compose(...args: string[]): string {
  return execFileSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', cwd: ROOT }).trim();
}

/**
 * The address reminders come from, as this install is configured.
 *
 * Read rather than hard-coded: docker-compose.mail.yml defaults it, an operator's .env
 * overrides it, and a test that assumed one of those would fail on the other machine for
 * a reason that has nothing to do with the product.
 */
// `||` rather than `??`: .env.example ships `MAIL_FROM=` empty, and compose treats an
// empty value as unset. A nullish check would take the empty string and disagree with the
// container about who reminders come from.
const MAIL_FROM = (process.env.MAIL_FROM?.trim() || 'Gather <documents@gather.test>')
  .replace(/^.*<|>.*$/g, '')
  .trim();

const ITEMS = [
  { type: 'File upload', label: 'Bank statements for the year' },
  { type: 'Short text', label: 'Your accountant reference' },
];

/** A firm, a client with a real address, a sent request, and reminders switched on. */
async function requestWithReminders(
  page: Page,
  prefix: string,
  title: string,
): Promise<{ requestId: string; clientEmail: string }> {
  await signUpOwner(page, prefix);
  const clientEmail = await addClient(page, 'Rosa Delgado');
  const requestId = await newRequest(page, title);
  await buildChecklist(page, 'What we need', ITEMS);

  // Issuing the first link is what marks a request "sent", which is where an escalating
  // ladder measures from and what makes the schedule eligible for the scan.
  await issuePortalLink(page, requestId);

  await page.goto(`/requests/${requestId}`);
  await expect(page.getByTestId('reminder-state')).toHaveText('Reminders off');

  await page.getByLabel('How often').selectOption('interval');
  await page.getByLabel('Days between reminders').fill('3');
  await page.getByLabel('Send at').fill('09:00');
  await page.getByTestId('save-schedule').click();

  await expect(page.getByTestId('reminder-state')).toHaveText('Reminders on');
  return { requestId, clientEmail };
}

test('① a schedule sends real reminders, and the log records what happened', async ({ page }) => {
  const { requestId, clientEmail } = await requestWithReminders(page, 'remind', 'Year-end pack');

  expect(await inboxFor(clientEmail)).toHaveLength(0);

  // The cadence says three days; this is the third day arriving.
  makeReminderDue(requestId);
  const first = await waitForMail(clientEmail, 1);

  expect(first[0]!.from).toBe(MAIL_FROM);
  // The subject carries the firm's own name, from the brand snapshot frozen when the
  // request was sent — not Gather's.
  expect(first[0]!.subject).toMatch(/^remind Accountants: Year-end pack$/);

  const opened = await readMessage(first[0]!.id);
  // The first message is the request itself, not a reminder — nobody has forgotten
  // anything yet.
  expect(opened.text).toContain('no account to create');
  expect(opened.text).toContain('Bank statements for the year');
  expect(opened.text).toContain(`/portal/${requestId}`);
  expect(opened.html).toContain('Open my checklist');

  // The schedule moved on rather than firing again.
  expect(scheduleRow(requestId)).toEqual({ active: true, sentCount: 1 });

  // …and the second one reads as a reminder, because now something has been forgotten.
  makeReminderDue(requestId);
  const both = await waitForMail(clientEmail, 2);
  const second = await readMessage(both[0]!.id);
  expect(second.subject).toBe('2 things left: Year-end pack');
  expect(second.text).toContain('Just a nudge');

  expect(scheduleRow(requestId)).toEqual({ active: true, sentCount: 2 });

  // The firm can see both, with the status the mail server actually reported.
  await page.reload();
  const log = page.getByTestId('reminder-log').locator('li');
  await expect(log).toHaveCount(2);
  await expect(log.first()).toContainText('Sent');
  await expect(log.first()).toContainText(clientEmail);
});

test('② marking a request complete stops the reminders', async ({ page }) => {
  const { requestId, clientEmail } = await requestWithReminders(page, 'stop', 'Close the books');

  makeReminderDue(requestId);
  await waitForMail(clientEmail, 1);

  await page.reload();
  await page.getByTestId('mark-complete').click();
  await expect(page.getByTestId('reminder-state')).toHaveText('Reminders off');

  // The row itself, not just the badge: `active=false` is what the worker's scan reads.
  expect(scheduleRow(requestId).active).toBe(false);

  // Make it due anyway — an operator with database access, or a race with a scan already
  // in flight. Nothing should go out.
  const forced = () => {
    try {
      makeReminderDue(requestId);
    } catch {
      // Expected: the update matches no active schedule. That is the point.
    }
  };
  forced();
  await expectNoMoreMail(clientEmail, 1, 20_000);
});

test('③ a client who sends everything back is not chased again', async ({ page, browser }) => {
  const { requestId, clientEmail } = await requestWithReminders(page, 'done', 'Onboarding');

  makeReminderDue(requestId);
  await waitForMail(clientEmail, 1);

  // The client fills the request in and sends it back.
  await page.goto(`/requests/${requestId}`);
  const link = await issuePortalLink(page, requestId);

  const clientContext = await browser.newContext();
  const clientPage = await clientContext.newPage();
  await clientPage.goto(link);

  await clientPage.getByLabel('Your accountant reference').fill('DEL-2026-118');
  await clientPage
    .getByTestId('portal-item')
    .filter({ hasText: 'Bank statements for the year' })
    .getByLabel('Add a file for Bank statements for the year')
    .setInputFiles({
      name: 'statements.pdf',
      mimeType: 'application/pdf',
      // A real, if small, PDF — the upload pipeline sniffs magic bytes and would
      // reject anything that only claimed to be one.
      buffer: Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
      ),
    });
  await expect(clientPage.getByTestId('uploaded-file')).toHaveCount(1, { timeout: 30_000 });
  await expect(clientPage.getByTestId('portal-progress')).toHaveText('2 of 2 done');

  await clientPage.getByTestId('portal-submit').click();
  await expect(clientPage.getByTestId('portal-submitted')).toBeVisible();

  // Sending it back stops the chasing in the same transaction as the status change.
  expect(scheduleRow(requestId).active).toBe(false);
  await expectNoMoreMail(clientEmail, 1, 15_000);

  await clientPage.close();
  await clientContext.close();
});

test('④ a worker that dies mid-send does not send the reminder twice when it restarts', async ({
  page,
}) => {
  const { requestId, clientEmail } = await requestWithReminders(page, 'once', 'No duplicates');

  // The window the guarantee is about: the claim row is written before the message is
  // handed to a mail driver, so a process killed there leaves a row and no email.
  const key = simulateCrashedClaim(requestId);
  expect(key).toMatch(/^schedule:[0-9a-f-]{36}:0$/);
  expect(reminderLogCount(requestId)).toBe(1);

  // Bring the sender back, the way a deploy or an OOM kill does.
  compose('restart', 'worker');

  // The reminder is still due — nothing was sent, so `sent_count` never moved and the
  // worker recomputes the identical key.
  makeReminderDue(requestId);

  // Long enough to be certain at least one scan ran: the cron fires every minute, so a
  // shorter window could pass simply because nothing looked.
  await expectNoMoreMail(clientEmail, 0, 90_000);
  expect(reminderLogCount(requestId), 'a second reminder_log row was written').toBe(1);

  // And it refused deliberately, rather than never having looked.
  const logs = compose('logs', '--tail', '80', 'worker');
  expect(logs).toContain('already claimed');
  expect(logs).toContain(key);
});

test('⑤ a manual nudge sends immediately without consuming a cadence step', async ({ page }) => {
  const { requestId, clientEmail } = await requestWithReminders(page, 'nudge', 'Quick chase');

  const before = scheduleRow(requestId);
  await page.getByTestId('send-now').click();
  await expect(page.getByText('Reminder sent.')).toBeVisible();

  const mail = await waitForMail(clientEmail, 1);
  const opened = await readMessage(mail[0]!.id);
  expect(opened.subject).toContain('Quick chase');

  // The schedule is untouched: a manual nudge is the firm stepping in, not the cadence
  // firing, and consuming a step would silently shorten the sequence they configured.
  expect(scheduleRow(requestId)).toEqual(before);
});

test('⑥ a bounce webhook flips the reminder and shows the firm what happened', async ({
  page,
  request,
}) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      'RESEND_WEBHOOK_SECRET is not set, so the webhook endpoint is disabled and this ' +
        'test cannot run. Set one in .env — any `whsec_<base64>` value works, because the ' +
        'test signs the payload with it.',
    );
  }

  const { requestId, clientEmail } = await requestWithReminders(page, 'bounce', 'Bounced pack');
  makeReminderDue(requestId);
  await waitForMail(clientEmail, 1);

  expect(reminderStatus(requestId)).toBe('sent');
  const messageId = lastProviderMessageId(requestId);

  // Exactly what Resend posts for a hard bounce, signed exactly the way Svix signs it.
  // The message itself went out over SMTP in this run, but the webhook handler neither
  // knows nor cares which driver produced the id it is matching on.
  const body = JSON.stringify({
    type: 'email.bounced',
    created_at: new Date().toISOString(),
    data: {
      email_id: messageId,
      to: [clientEmail],
      bounce: {
        type: 'Permanent',
        subType: 'General',
        message: 'The email account that you tried to reach does not exist.',
      },
    },
  });

  const svixId = 'msg_2gather_test';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64'))
    .update(`${svixId}.${timestamp}.${body}`)
    .digest('base64');

  const accepted = await request.post('/api/webhooks/resend', {
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    data: body,
  });
  expect(accepted.status()).toBe(200);
  expect(await accepted.json()).toMatchObject({ ok: true, matched: true });

  expect(reminderStatus(requestId)).toBe('bounced');

  // The firm sees it, in the words a person needs rather than a status code.
  await page.reload();
  await expect(page.getByTestId('reminder-log').locator('li').first()).toContainText(
    'Bounced — the address rejected it',
  );
  await expect(page.getByTestId('reminder-log').locator('li').first()).toContainText(
    'does not exist',
  );

  // A bounce is worth a permanent record: it is the evidence that a client was never
  // actually reachable at the address on file.
  expect(auditActions(requestId)).toContain('reminder.bounced');

  // An unsigned copy of the same payload is refused outright.
  const forged = await request.post('/api/webhooks/resend', {
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': 'v1,not-a-real-signature',
    },
    data: body,
  });
  expect(forged.status()).toBe(401);

  // …and a late "delivered" cannot undo the bounce, because Resend promises no ordering
  // and the outcome is what the firm needs to see.
  const late = JSON.stringify({ type: 'email.delivered', data: { email_id: messageId } });
  const lateTimestamp = String(Math.floor(Date.now() / 1000));
  const lateSignature = createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64'))
    .update(`${svixId}.${lateTimestamp}.${late}`)
    .digest('base64');

  await request.post('/api/webhooks/resend', {
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': lateTimestamp,
      'svix-signature': `v1,${lateSignature}`,
    },
    data: late,
  });
  expect(reminderStatus(requestId)).toBe('bounced');
});
