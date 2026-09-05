import { env, type Env } from '@gather/core';
import { MailError, type MailMessage, type SentMail } from './message.js';
import { ResendMail } from './resend.js';
import { SmtpMail } from './smtp.js';

export { domainOf, formatAddress, MailError, type MailMessage, type SentMail } from './message.js';

export { ResendMail, type ResendOptions } from './resend.js';
export { SmtpMail, type SmtpOptions } from './smtp.js';

export {
  renderReminderEmail,
  renderRequestEmail,
  renderTestEmail,
  type Brand,
  type ReminderContent,
  type RenderedEmail,
} from './templates.js';

export {
  checkDeliverability,
  checkDkim,
  checkDmarc,
  checkMx,
  checkSpf,
  type CheckResult,
  type CheckStatus,
  type DeliverabilityReport,
} from './dns.js';

export {
  HANDLED_EVENTS,
  shouldReplaceStatus,
  statusForEvent,
  svixHeaders,
  verifyWebhook,
  type HandledEvent,
  type ResendWebhookPayload,
  type WebhookHeaders,
  type WebhookRejection,
  type WebhookResult,
} from './webhook.js';

/**
 * Anything that can send an email.
 *
 * Two real implementations and one that refuses. `NoMail` is not a stub — it is the
 * configured behaviour of an install with no mail credentials, and it exists so that every
 * caller has one thing to handle rather than two: a driver that is absent, and a driver
 * that failed. `mailConfigured()` is what the UI asks before offering to send anything.
 */
export interface MailDriver {
  readonly name: string;
  send(message: MailMessage): Promise<SentMail>;
  close?(): Promise<void>;
}

export class NoMail implements MailDriver {
  readonly name = 'none';

  send(): Promise<SentMail> {
    return Promise.reject(
      new MailError(
        'No email is configured on this Gather. Set MAIL_DRIVER to "resend" or "smtp" in ' +
          'your .env and restart — see .env.example for what each one needs.',
        { retryable: false },
      ),
    );
  }
}

export function mailConfigured(config: Env = env()): boolean {
  return config.MAIL_DRIVER !== 'none';
}

export function createMail(config: Env = env()): MailDriver {
  if (config.MAIL_DRIVER === 'resend') {
    // The env schema refuses `resend` without these two, so they are present.
    return new ResendMail({ apiKey: config.RESEND_API_KEY!, from: config.MAIL_FROM! });
  }

  if (config.MAIL_DRIVER === 'smtp') {
    return new SmtpMail({
      host: config.SMTP_HOST!,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      user: config.SMTP_USER,
      password: config.SMTP_PASSWORD,
      from: config.MAIL_FROM!,
      requireValidCertificate: config.SMTP_REQUIRE_VALID_CERT,
    });
  }

  return new NoMail();
}

interface MailSingleton {
  driver: MailDriver;
}

// The SMTP driver holds a connection pool; Next replaces the module registry on every hot
// reload, so without a global handle each reload would leak one.
const globalRef = globalThis as typeof globalThis & { __gatherMail?: MailSingleton };

export function getMail(): MailDriver {
  globalRef.__gatherMail ??= { driver: createMail() };
  return globalRef.__gatherMail.driver;
}
