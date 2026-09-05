/**
 * One email, in the only shape Gather ever sends.
 *
 * Deliberately small. Gather sends reminders and test messages — not campaigns — so there
 * is no attachment support, no templating language and no list management here. Anything
 * a driver cannot express is a driver's problem, not a reason to widen this.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /**
   * The plain-text alternative, and not an optional courtesy: a multipart message with a
   * real text part is treated far better by spam filters than an HTML-only one, and it is
   * what a client reading on a watch or in a terminal actually gets.
   */
  text: string;
  replyTo?: string;
  /**
   * Passed to Resend as `Idempotency-Key` and used to build a `Message-ID` for SMTP.
   * Gather also enforces this in the database, because SMTP has no such concept and a
   * guarantee that depends on the provider is not a guarantee.
   */
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface SentMail {
  /** The provider's id, when there is one. SMTP servers return a queue id at best. */
  providerMessageId: string | null;
  /** Which driver actually sent it, for the reminder log. */
  driver: string;
}

/**
 * A send that failed in a way worth telling the operator about.
 *
 * `retryable` is what the worker uses to decide between backing off and giving up. A
 * mailbox that does not exist will not start existing; a 429 or a refused TCP connection
 * very well might.
 */
export class MailError extends Error {
  constructor(
    message: string,
    readonly options: { retryable: boolean; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'MailError';
  }

  get retryable(): boolean {
    return this.options.retryable;
  }
}

/** `Alex at Delgado Bookkeeping <alex@example.com>` — quoted when the name needs it. */
export function formatAddress(name: string, address: string): string {
  const trimmed = name.trim();
  if (!trimmed) return address;
  // RFC 5322: a display name containing specials must be a quoted-string.
  const needsQuotes = /[()<>[\]:;@\\,."]/.test(trimmed);
  const display = needsQuotes ? `"${trimmed.replace(/(["\\])/g, '\\$1')}"` : trimmed;
  return `${display} <${address}>`;
}

/** The domain an address sends from, for the SPF/DKIM/DMARC preflight. */
export function domainOf(address: string): string {
  const match = /<([^>]+)>\s*$/.exec(address);
  const bare = (match?.[1] ?? address).trim();
  const at = bare.lastIndexOf('@');
  if (at === -1) throw new Error(`"${address}" is not an email address.`);
  return bare.slice(at + 1).toLowerCase();
}
