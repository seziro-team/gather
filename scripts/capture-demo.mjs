#!/usr/bin/env node
/**
 * Capture the marketing images from the running product.
 *
 *   docker compose up -d
 *   node scripts/capture-demo.mjs
 *
 * Everything under `site/public/shots/` and the README's demo are produced by this script
 * driving a real Gather with a real browser: a real firm, a real client, a real IRS W-9
 * uploaded through the real portal, a real rejection with a real note. Nothing is mocked
 * and nothing is drawn in a design tool — if the product changes, re-run this and the
 * screenshots change with it. That is the point: a marketing site whose screenshots cannot
 * drift from the software is a marketing site that cannot lie.
 *
 * Writes:
 *   site/public/shots/*.png   the stills used on the page
 *   site/public/og.png        the social card, composed from a real screenshot
 *   site/public/demo.gif      the loop, from a real recording
 *
 * Needs: a running install (GATHER_E2E_URL, default http://localhost:3000) with sign-ups
 * open, `oathtool` for the two-factor step, and ffmpeg for the gif.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.GATHER_E2E_URL ?? 'http://localhost:3000';
const SHOTS = join(ROOT, 'site/public/shots');
const PUBLIC = join(ROOT, 'site/public');
const VIDEO = join(ROOT, 'artifacts/demo-video');
const PASSWORD = 'correct horse battery staple';
const STAMP = Date.now();

// Real accounts on a real install, but named like a firm rather than like a fixture — the
// screenshots are the product's face. `example.com` and `example.org` are reserved by
// RFC 2606 precisely so documentation can use them without touching anyone's mailbox.
// If the address is already taken (a second run against the same install) the script falls
// back to a stamped one rather than failing: an honest, slightly uglier screenshot beats no
// screenshot.
const FIRM_EMAIL = process.env.GATHER_DEMO_EMAIL ?? 'dana@delgado.example.com';
const CLIENT_EMAIL = 'accounts@rivera.example.com';

const step = (message) => console.log(`▸ ${message}`);

function totp(secret) {
  return execFileSync('oathtool', ['--totp', '--base32', secret], { encoding: 'utf8' }).trim();
}

/** Signs up a firm and finishes two-factor, exactly as a new user would. */
async function signUpOwner(page, { name, firmName, email }) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Firm name').fill(firmName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Either we land on two-factor setup, or the address is already taken because this
  // install has been captured from before.
  //
  // Waiting on the URL rather than on an alert: Next renders an always-present, always-empty
  // `role="alert"` route announcer, so "an alert became visible" is true on every page and
  // means nothing.
  try {
    await page.waitForURL(/\/account\/security/, { timeout: 20_000 });
  } catch {
    const said = await page
      .getByRole('alert')
      .filter({ hasText: /\S/ })
      .first()
      .innerText()
      .catch(() => 'no reason given');
    const fallback = email.replace('@', `.${STAMP}@`);
    console.warn(`! could not create ${email} (${said.trim()}) — using ${fallback}`);
    await page.goto(`${BASE}/sign-up`);
    await page.getByLabel('Your name').fill(name);
    await page.getByLabel('Firm name').fill(firmName);
    await page.getByLabel('Email').fill(fallback);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/account\/security/);
  }

  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.getByTestId('totp-secret').innerText()).trim();
  await page.getByLabel('Enter the current 6-digit code to finish').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await page.waitForURL(/\/dashboard/);
}

/**
 * Puts a heading at the top of the viewport.
 *
 * `scrollIntoViewIfNeeded` is not enough: a heading that is already just-visible at the
 * bottom counts as "needed: no", and the screenshot frames the section above it instead.
 */
async function frame(page, name) {
  await page
    .getByRole('heading', { name, exact: true })
    .first()
    .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
}

/**
 * Answers every required item still outstanding.
 *
 * Generic rather than a hard-coded list, because the built-in templates are free to change
 * and a capture script that knows their contents by heart is a capture script that breaks
 * silently the next time one does.
 */
async function fillRequired(page) {
  // Files first: the same real W-9 for each, which is what a client doing this in a hurry
  // with one scanned page would do.
  const uploads = await page.locator('input[type="file"]').all();
  for (const upload of uploads) {
    const item = page.locator('li', { has: upload }).first();
    if ((await item.getByText('irs-form-w9.pdf').count()) > 0) continue;
    await upload.setInputFiles(join(ROOT, 'e2e/fixtures/irs-form-w9.pdf'));
    await page.waitForTimeout(1200);
  }

  // Yes/no is a pair of visually-styled labels wrapping screen-reader-only radios, so the
  // label is what a person taps and what this taps too.
  for (const option of await page.locator('label').filter({ hasText: /^No$/ }).all()) {
    await option.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1500);
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  step(`shot: ${name}.png`);
}

async function main() {
  rmSync(SHOTS, { recursive: true, force: true });
  rmSync(VIDEO, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });

  const browser = await chromium.launch();

  // The firm's browser: a 1280×800 desktop, recorded, because the demo loop is the firm's
  // side and the phone side stitched together.
  const recordingStartedAt = Date.now();
  const firmContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    recordVideo: { dir: VIDEO, size: { width: 1280, height: 800 } },
  });
  const firm = await firmContext.newPage();

  step('signing up a firm');
  await signUpOwner(firm, {
    name: 'Dana Delgado',
    firmName: 'Delgado & Co',
    email: FIRM_EMAIL,
  });

  step('adding a client');
  await firm.goto(`${BASE}/clients/new`);
  await firm.getByLabel('Name').fill('Rivera Landscaping');
  await firm.getByLabel('Email').fill(CLIENT_EMAIL);
  await firm.getByRole('button', { name: 'Add client' }).click();
  await firm.waitForURL(/\/clients$/);

  step('building a request from the US individual tax template');
  await firm.goto(`${BASE}/requests/new`);
  const templateValue = await firm
    .locator('select[name="templateId"] option')
    .filter({ hasText: 'US individual' })
    .first()
    .getAttribute('value');
  if (templateValue) await firm.getByLabel('Start from').selectOption(templateValue);
  await firm.getByLabel('Title').fill('2025 tax return — documents');
  await firm.getByRole('button', { name: 'Create request' }).click();
  await firm.waitForURL(/\/requests\/[0-9a-f-]+\/edit$/);
  const requestId = new URL(firm.url()).pathname.split('/')[2];

  await firm.waitForTimeout(500);
  await shot(firm, 'builder');

  step('issuing a portal link');
  await firm.goto(`${BASE}/requests/${requestId}`);
  await firm.getByTestId('create-link').click();
  const portalUrl = (await firm.getByTestId('portal-url').innerText()).trim();
  await shot(firm, 'request');

  // ── The client's side: a real phone profile, no account, one link ──────────
  step('opening the portal on a phone');
  const phoneContext = await browser.newContext({
    ...devices['iPhone 14'],
    viewport: { width: 390, height: 844 },
  });
  const phone = await phoneContext.newPage();
  await phone.goto(portalUrl);
  await phone.waitForURL(/\/portal\//);
  await phone.waitForTimeout(500);
  await shot(phone, 'portal-phone');

  step('uploading a real IRS W-9 through the portal');
  const firstUpload = phone.locator('input[type="file"]').first();
  await firstUpload.setInputFiles(join(ROOT, 'e2e/fixtures/irs-form-w9.pdf'));
  await phone.getByText('form-w9', { exact: false }).first().waitFor({ timeout: 60_000 });
  await phone.waitForTimeout(500);
  await shot(phone, 'portal-uploaded');

  // Finish the rest of what the template requires, so the request really does come back to
  // the firm. Without this the dashboard is honestly empty — nothing is waiting, because
  // the client has not sent anything — and the screenshot would undersell the product by
  // showing a state a real firm would rarely be looking at.
  step('answering the rest of what the template requires');
  await fillRequired(phone);
  const submit = phone.getByTestId('portal-submit');
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await phone.getByTestId('portal-submitted').waitFor({ timeout: 30_000 });
  await phone.waitForTimeout(400);
  await shot(phone, 'portal-submitted');

  step('the dashboard, with the client’s work waiting on the firm');
  await firm.goto(`${BASE}/dashboard`);
  await firm.waitForTimeout(600);
  await shot(firm, 'dashboard');

  // ── The demo loop ─────────────────────────────────────────────────────────
  // The recording runs for the whole session, but the gif is only this: the firm going
  // through what came back and sending one item back with a note. That is the mechanic the
  // product turns on, it fits in a few seconds, and a loop of somebody filling in a sign-up
  // form is a loop nobody watches. The window is measured off the wall clock rather than
  // hard-coded, so adding a step above it cannot silently shift the gif onto a password
  // field — which is exactly what happened when it was a fixed number.
  const demoStartedAt = Date.now();

  step('the firm reviewing, and sending one item back with a note');
  await firm.goto(`${BASE}/requests/${requestId}`);
  await frame(firm, 'Review');
  await shot(firm, 'review');

  // A real rejection, with a real note — the mechanic the whole product turns on. The
  // client sees this sentence, so it is written the way an accountant would write it.
  const reject = firm.getByTestId('reject').first();
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await firm
      .getByLabel('What needs fixing? The client sees this and nothing else.')
      .first()
      .fill('This is page 1 only — I need all four pages, including the signature page.');
    await firm.getByTestId('confirm-reject').first().click();
    await firm.waitForTimeout(1200);
    await shot(firm, 'rejected');
  }

  const demoEndedAt = Date.now();
  const trimSeconds = Math.max(0, (demoStartedAt - recordingStartedAt) / 1000 - 1);
  const demoSeconds = Math.min(30, (demoEndedAt - demoStartedAt) / 1000 + 2);

  step('what the client sees when an item comes back');
  await phone.reload();
  await phone.waitForTimeout(800);
  await shot(phone, 'portal-rejected');

  step('the audit trail');
  await firm.goto(`${BASE}/requests/${requestId}`);
  await frame(firm, 'History');
  await shot(firm, 'audit');

  await phoneContext.close();
  await firmContext.close();
  await browser.close();

  // ── The gif ────────────────────────────────────────────────────────────────
  const recording = readdirSync(VIDEO).find((file) => file.endsWith('.webm'));
  if (recording) {
    step('converting the recording to a gif');
    const source = join(VIDEO, recording);
    // Two passes: build a palette from the whole clip, then map to it. One pass gives a
    // 256-colour guess per frame and a demo that shimmers.
    //
    // 6fps at 720px, 48 colours, no dithering. This is flat UI, so a small palette costs
    // nothing and the dither pattern is what makes a GIF of a webpage enormous — the
    // difference between roughly 1 MB and roughly 10 MB, which is the difference between a
    // hero image and a visitor who has already left.
    const palette = join(VIDEO, 'palette.png');
    const filters = 'fps=6,scale=720:-1:flags=lanczos';
    const window = ['-ss', trimSeconds.toFixed(1), '-t', demoSeconds.toFixed(1)];

    execFileSync('ffmpeg', [
      '-y',
      ...window,
      '-i',
      source,
      '-vf',
      `${filters},palettegen=max_colors=48:stats_mode=diff`,
      palette,
    ]);
    execFileSync('ffmpeg', [
      '-y',
      ...window,
      '-i',
      source,
      '-i',
      palette,
      '-lavfi',
      `${filters}[x];[x][1:v]paletteuse=dither=none`,
      join(PUBLIC, 'demo.gif'),
    ]);
    step(`demo.gif written — ${demoSeconds.toFixed(1)}s from ${trimSeconds.toFixed(1)}s in`);
  } else {
    console.warn('! no recording found — skipping the gif');
  }

  // ── The social card ────────────────────────────────────────────────────────
  // 1200×630, composed from the real dashboard rather than drawn: the picture somebody
  // sees before they click should be the thing they are about to get.
  step('composing the OG image from the dashboard screenshot');
  execFileSync('convert', [
    join(SHOTS, 'dashboard.png'),
    '-resize',
    '1200x',
    '-gravity',
    'north',
    '-crop',
    '1200x630+0+0',
    '+repage',
    '-bordercolor',
    '#0f766e',
    '-border',
    '0',
    join(PUBLIC, 'og.png'),
  ]);

  console.log('\nDone. Assets in site/public/.');
}

await main();
