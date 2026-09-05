import { loadEnv, type Env } from '@gather/core';
import { checkDeliverability, type CheckResult } from '../dns.js';
import { createMail } from '../index.js';
import { domainOf } from '../message.js';
import { renderTestEmail } from '../templates.js';

/**
 * `pnpm check:email` — the preflight that stops reminders failing silently.
 *
 * plan.md §10 rates deliverability as the most likely real-world failure of a self-hosted
 * Gather, and the reason is that it fails *quietly*: messages are accepted, the firm sees
 * green ticks, and every reminder is in a spam folder. Nobody finds out until a client says
 * "you never asked me for that".
 *
 * So this does the two things a person cannot easily do themselves: read the three DNS
 * records that decide the outcome, and actually send a message to an address they can open.
 *
 *   pnpm check:email                      # DNS only
 *   pnpm check:email you@example.com      # DNS, then a real test message
 *
 * Exit codes are meant for a deploy script: 0 all good, 1 something is wrong.
 */

const GREEN = '[32m';
const YELLOW = '[33m';
const RED = '[31m';
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

// Respect NO_COLOR, and do not emit escape codes into a redirected log file.
const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string) => (colour ? `${code}${text}${RESET}` : text);

const MARK = { pass: '✓', warn: '!', fail: '✗' } as const;
const TINT = { pass: GREEN, warn: YELLOW, fail: RED } as const;

function line(result: CheckResult): void {
  console.log(
    `  ${paint(TINT[result.status], MARK[result.status])} ${paint(BOLD, result.name.padEnd(6))} ${result.detail}`,
  );
  if (result.fix) {
    for (const wrapped of wrap(result.fix, 76)) console.log(paint(DIM, `      ${wrapped}`));
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function main(): Promise<number> {
  let config: Env;
  try {
    config = loadEnv();
  } catch (error) {
    console.error(paint(RED, (error as Error).message));
    return 1;
  }

  console.log(`\n${paint(BOLD, 'Gather email preflight')}\n`);

  if (config.MAIL_DRIVER === 'none') {
    console.log(
      paint(RED, '  ✗ No email is configured.') +
        '\n\n' +
        paint(DIM, '      Set MAIL_DRIVER to "resend" or "smtp" in your .env, along with\n') +
        paint(DIM, '      MAIL_FROM and the credentials for whichever you chose. Until then\n') +
        paint(DIM, '      Gather cannot send reminders, and the request page says so.\n'),
    );
    return 1;
  }

  const from = config.MAIL_FROM!;
  const domain = domainOf(from);

  console.log(`  Driver     ${paint(BOLD, config.MAIL_DRIVER)}`);
  console.log(`  From       ${from}`);
  if (config.MAIL_DRIVER === 'smtp') {
    console.log(
      `  Server     ${config.SMTP_HOST}:${config.SMTP_PORT} ` +
        `(${config.SMTP_SECURE ? 'implicit TLS' : 'STARTTLS'}` +
        `${config.SMTP_REQUIRE_VALID_CERT ? '' : ', certificate NOT verified'})`,
    );
  }
  console.log(`\n  ${paint(BOLD, `DNS for ${domain}`)}\n`);

  // Both selectors are tried: Resend publishes under "resend", and a firm running its own
  // mail server picked its own, which MAIL_DKIM_SELECTOR names.
  const selectors = [...new Set([config.MAIL_DKIM_SELECTOR, 'resend', 'default'])];
  const report = await checkDeliverability(domain, selectors);
  for (const result of report.checks) line(result);

  const summary = {
    pass: `${paint(GREEN, '✓')} DNS looks right.`,
    warn: `${paint(YELLOW, '!')} DNS will work, but read the notes above.`,
    fail: `${paint(RED, '✗')} DNS is not ready — reminders are likely to land in spam.`,
  }[report.status];
  console.log(`\n  ${summary}`);

  const recipient = process.argv[2];
  if (!recipient) {
    console.log(
      paint(
        DIM,
        '\n  No test recipient given. Pass one to send a real message:\n' +
          '      pnpm check:email you@example.com\n',
      ),
    );
    return report.status === 'fail' ? 1 : 0;
  }

  console.log(`\n  ${paint(BOLD, 'Test message')}\n`);
  const mail = createMail(config);
  const email = renderTestEmail(
    { firmName: 'Gather', color: '#0f766e', logoUrl: null },
    config.GATHER_APP_URL,
  );

  try {
    const sent = await mail.send({
      to: recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // Bounded to the minute so that re-running the check twice in quick succession does
      // not spam the operator's own inbox, while a deliberate retry later still sends.
      idempotencyKey: `check-email:${recipient}:${new Date().toISOString().slice(0, 16)}`,
    });

    console.log(`  ${paint(GREEN, '✓')} Sent to ${recipient} via ${sent.driver}.`);
    if (sent.providerMessageId) console.log(`      id ${sent.providerMessageId}`);
    console.log(
      paint(
        DIM,
        '\n      Now go and look. It has to be in the inbox, not in spam — this check\n' +
          '      proves the message was accepted, which is not the same as delivered.\n',
      ),
    );
  } catch (error) {
    console.log(`  ${paint(RED, '✗')} ${(error as Error).message}`);
    await mail.close?.();
    return 1;
  }

  await mail.close?.();
  return report.status === 'fail' ? 1 : 0;
}

process.exitCode = await main();
