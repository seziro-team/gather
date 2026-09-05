import { MailError, type MailMessage, type SentMail } from './message.js';

/**
 * The Resend driver.
 *
 * Endpoint, headers, body fields and response shape verified against
 * https://resend.com/docs/api-reference/emails/send-email on 2026-09-05:
 *
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer re_…
 *   Idempotency-Key: <=256 chars, expires after 24 h
 *   { from, to (<=50), subject, html | text | react | template, reply_to, headers }
 *   → 200 { "id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }
 *
 * Written against `fetch` rather than the `resend` SDK. The SDK is a thin wrapper over one
 * POST, and this way the dependency surface of a package that handles a firm's sending
 * credentials stays at zero.
 */

const ENDPOINT = 'https://api.resend.com/emails';

/** Resend's default is 10 requests/second per team; a send that takes longer has stalled. */
const TIMEOUT_MS = 15_000;

export interface ResendOptions {
  apiKey: string;
  from: string;
  endpoint?: string;
}

interface ResendSuccess {
  id: string;
}

interface ResendFailure {
  name?: string;
  message?: string;
  statusCode?: number;
}

export class ResendMail {
  readonly name = 'resend';

  constructor(private readonly options: ResendOptions) {}

  async send(message: MailMessage): Promise<SentMail> {
    const body: Record<string, unknown> = {
      from: this.options.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    };
    if (message.replyTo) body.reply_to = message.replyTo;
    if (message.headers) body.headers = message.headers;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (message.idempotencyKey) {
      // The documented ceiling is 256 characters. Ours are far shorter, but a key that is
      // silently truncated by the provider is a duplicate send waiting to happen.
      headers['Idempotency-Key'] = message.idempotencyKey.slice(0, 256);
    }

    let response: Response;
    try {
      response = await fetch(this.options.endpoint ?? ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      // DNS, TLS, connection reset, timeout — all worth another go.
      throw new MailError(`Could not reach Resend: ${(cause as Error).message}`, {
        retryable: true,
        cause,
      });
    }

    const payload = (await response.json().catch(() => ({}))) as ResendSuccess & ResendFailure;

    if (!response.ok) {
      throw new MailError(describe(response.status, payload), {
        // 429 is the documented rate limit; 5xx is theirs to fix and ours to retry.
        // 4xx otherwise means the message itself is wrong and will stay wrong.
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
      });
    }

    if (!payload.id) {
      throw new MailError('Resend accepted the message but returned no id.', { retryable: true });
    }

    return { providerMessageId: payload.id, driver: this.name };
  }
}

function describe(status: number, payload: ResendFailure): string {
  const detail = payload.message ?? payload.name ?? 'no detail given';

  if (status === 401 || status === 403) {
    return `Resend rejected the API key (${status}): ${detail}. Check RESEND_API_KEY.`;
  }
  if (status === 422) {
    return (
      `Resend refused the message (422): ${detail}. This is usually a "from" address on a ` +
      `domain that has not been verified in the Resend dashboard.`
    );
  }
  if (status === 429) {
    return `Resend rate limit (429): ${detail}. Gather will back off and try again.`;
  }
  return `Resend returned ${status}: ${detail}`;
}
