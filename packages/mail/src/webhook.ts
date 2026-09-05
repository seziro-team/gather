import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifying a Resend webhook.
 *
 * Resend signs with Svix. The scheme, read from
 * https://docs.svix.com/receiving/verifying-payloads/how-manual on 2026-09-05:
 *
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = HMAC-SHA256(base64decode(secret without "whsec_"), signed content)
 *   header         = space-delimited list of `v1,<base64 signature>`
 *
 * Implemented here rather than taken from the `svix` package because it is twenty lines of
 * HMAC, and because a webhook endpoint that ingests bounce data is exactly the sort of
 * thing whose verification should be readable in the repository that depends on it.
 *
 * The raw body matters. Anything that re-serialises JSON before this runs — a framework
 * body parser, a proxy that reformats — changes a byte and invalidates every signature.
 */

/** Svix's own recommendation; also the window outside which a replay is not worth accepting. */
const TOLERANCE_SECONDS = 5 * 60;

export type WebhookRejection =
  'missing-headers' | 'bad-secret' | 'timestamp-out-of-tolerance' | 'no-matching-signature';

export type WebhookResult = { ok: true } | { ok: false; reason: WebhookRejection };

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/** Pull the three Svix headers out of anything header-shaped. */
export function svixHeaders(headers: Headers): WebhookHeaders {
  return {
    id: headers.get('svix-id'),
    timestamp: headers.get('svix-timestamp'),
    signature: headers.get('svix-signature'),
  };
}

export function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  rawBody: string,
  now: Date = new Date(),
): WebhookResult {
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'missing-headers' };
  }

  const seconds = Number(headers.timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'timestamp-out-of-tolerance' };
  const drift = Math.abs(now.getTime() / 1000 - seconds);
  if (drift > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp-out-of-tolerance' };

  let key: Buffer;
  try {
    const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
    key = Buffer.from(encoded, 'base64');
    if (key.length === 0) throw new Error('empty');
  } catch {
    return { ok: false, reason: 'bad-secret' };
  }

  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();

  // The header may carry several signatures — Svix sends both during a secret rotation, so
  // rejecting anything with more than one would break exactly when it matters most.
  for (const entry of headers.signature.split(' ')) {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) continue;

    let candidate: Buffer;
    try {
      candidate = Buffer.from(value, 'base64');
    } catch {
      continue;
    }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'no-matching-signature' };
}

/**
 * The webhook event types Gather acts on.
 *
 * Read from https://resend.com/docs/dashboard/webhooks/event-types on 2026-09-05. Gather
 * subscribes to the delivery-outcome events only: opens and clicks are tracking, they need
 * a pixel and a link rewriter, and neither belongs in an email asking somebody for their
 * tax documents.
 */
export const HANDLED_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export interface ResendWebhookPayload {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    subject?: string;
    /** Present on bounces: `{ message, subType, type }`. */
    bounce?: { message?: string; subType?: string; type?: string };
    reason?: string;
  };
}

/** The reminder-log status an event maps to, or `null` for events we do not record. */
export function statusForEvent(type: string): string | null {
  switch (type) {
    case 'email.sent':
      return 'sent';
    case 'email.delivered':
      return 'delivered';
    case 'email.delivery_delayed':
      return 'delayed';
    case 'email.bounced':
      return 'bounced';
    case 'email.complained':
      return 'complained';
    case 'email.failed':
      return 'failed';
    default:
      return null;
  }
}

/**
 * Which statuses are final, so a late `email.sent` cannot overwrite a `bounced`.
 *
 * Resend does not promise ordering, and the delivered/bounced outcome is the one a firm
 * needs to see. Once a message has an outcome, earlier-stage events are ignored.
 */
const RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delayed: 2,
  delivered: 3,
  failed: 4,
  bounced: 5,
  complained: 6,
};

export function shouldReplaceStatus(current: string, incoming: string): boolean {
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0);
}
