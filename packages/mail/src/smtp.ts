import { createTransport, type Transporter } from 'nodemailer';
import { MailError, type MailMessage, type SentMail } from './message.js';

/**
 * The SMTP driver — and a first-class path, not a fallback.
 *
 * plan.md §4.5 records why: Resend's free tier is 3,000 emails a month but only **100 a
 * day**, and a firm sending organizers to its client list in January goes through that
 * before lunch. A self-hoster with their own mail server, or a Postmark/Mailgun/SES SMTP
 * endpoint, has no such ceiling. Telling those people to sign up for a SaaS to use a
 * self-hosted product would be absurd.
 */

export interface SmtpOptions {
  host: string;
  port: number;
  /** Implicit TLS (port 465). Port 587 upgrades with STARTTLS instead, which is the norm. */
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  /**
   * Whether to insist on a valid certificate. On by default and documented as a thing you
   * turn off only for a mail server on your own network with a self-signed certificate.
   */
  requireValidCertificate: boolean;
}

export class SmtpMail {
  readonly name = 'smtp';
  private transport: Transporter | null = null;

  constructor(private readonly options: SmtpOptions) {}

  /**
   * One pooled transport for the process.
   *
   * Reminders go out in bursts — a scan finds twelve overdue requests at 09:00 — and a new
   * TCP connection, TLS handshake and AUTH per message is both slow and the kind of thing
   * that gets an IP rate-limited by its own provider.
   */
  private connection(): Transporter {
    this.transport ??= createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth: this.options.user
        ? { user: this.options.user, pass: this.options.password ?? '' }
        : undefined,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      tls: { rejectUnauthorized: this.options.requireValidCertificate },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return this.transport;
  }

  async send(message: MailMessage): Promise<SentMail> {
    const headers: Record<string, string> = { ...message.headers };

    let messageId: string | undefined;
    if (message.idempotencyKey) {
      // SMTP has no idempotency key. What it has is Message-ID, which a receiving server
      // may use to collapse duplicates — so a deterministic one turns a retry that got
      // through twice into one message in the client's inbox rather than two.
      //
      // This is a courtesy, not the guarantee. The guarantee is a unique index in Postgres
      // (see reminder_log.idempotency_key), because nothing here can depend on the
      // politeness of a mail server we do not run.
      messageId = `<${message.idempotencyKey}@${domainFromAddress(this.options.from)}>`;
    }

    try {
      const info = await this.connection().sendMail({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        messageId,
        headers,
      });

      return { providerMessageId: info.messageId ?? null, driver: this.name };
    } catch (cause) {
      throw new MailError(describe(cause), {
        retryable: isRetryable(cause),
        status: (cause as { responseCode?: number }).responseCode,
        cause,
      });
    }
  }

  async close(): Promise<void> {
    this.transport?.close();
    this.transport = null;
  }
}

function domainFromAddress(from: string): string {
  const match = /<([^>]+)>\s*$/.exec(from);
  const bare = (match?.[1] ?? from).trim();
  return bare.slice(bare.lastIndexOf('@') + 1) || 'localhost';
}

/**
 * SMTP says which failures are permanent: a 5xx reply is a rejection, a 4xx is "not now".
 * Anything that never got a reply at all — a refused connection, a timeout, a DNS failure —
 * is worth retrying, because the message may simply not have been sent yet.
 */
function isRetryable(error: unknown): boolean {
  const code = (error as { responseCode?: number }).responseCode;
  if (typeof code === 'number') return code < 500;

  const syscall = (error as { code?: string }).code;
  return (
    syscall === undefined ||
    ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'ESOCKET'].includes(
      syscall,
    )
  );
}

function describe(error: unknown): string {
  const code = (error as { code?: string }).code;
  const message = (error as Error).message ?? String(error);

  if (code === 'ECONNREFUSED') {
    return `The SMTP server refused the connection: ${message}. Check SMTP_HOST and SMTP_PORT.`;
  }
  if (code === 'EAUTH') {
    return `The SMTP server rejected the credentials: ${message}. Check SMTP_USER and SMTP_PASSWORD.`;
  }
  if (code === 'ESOCKET' && /certificate/i.test(message)) {
    return (
      `The SMTP server's TLS certificate was not accepted: ${message}. If this is your own ` +
      `server with a self-signed certificate, set SMTP_REQUIRE_VALID_CERT=false.`
    );
  }
  return `SMTP send failed: ${message}`;
}
