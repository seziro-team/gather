import type { NextRequest } from 'next/server';
import { env } from '@gather/core';
import { applyDeliveryEvent, appendAuditEvent, getDb, request as requestTable } from '@gather/db';
import { eq } from 'drizzle-orm';
import {
  shouldReplaceStatus,
  statusForEvent,
  svixHeaders,
  verifyWebhook,
  type ResendWebhookPayload,
} from '@gather/mail';
import { logger } from '@/lib/logger';

/**
 * Resend telling us what actually happened to a message.
 *
 * This is the difference between "Gather sent it" and "the client got it", and it is the
 * only way a firm ever finds out that a client's address bounces. Without it the reminder
 * log is a list of things we handed to a mail server and stopped caring about.
 *
 * Signed with Svix; the scheme and the verification live in @gather/mail. The raw body is
 * read as text and never re-serialised, because the signature covers the exact bytes.
 *
 * Configure it at https://resend.com/webhooks pointing at
 * `<GATHER_APP_URL>/api/webhooks/resend`, and put the signing secret in
 * RESEND_WEBHOOK_SECRET.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(httpRequest: NextRequest): Promise<Response> {
  const config = env();
  const secret = config.RESEND_WEBHOOK_SECRET;

  if (!secret) {
    // Not an error the sender can fix, and not something to accept blindly either: an
    // unverified webhook endpoint is a way to write arbitrary statuses into the log.
    logger.warn('a Resend webhook arrived but RESEND_WEBHOOK_SECRET is not set — ignoring it');
    return new Response('Webhooks are not configured on this install.', { status: 503 });
  }

  const raw = await httpRequest.text();
  const verified = verifyWebhook(secret, svixHeaders(httpRequest.headers), raw);
  if (!verified.ok) {
    logger.warn('rejected a Resend webhook', { reason: verified.reason });
    // 401 rather than 400: Svix retries on 5xx, and a signature that does not verify will
    // never verify, so there is nothing to retry.
    return new Response('Signature could not be verified.', { status: 401 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(raw) as ResendWebhookPayload;
  } catch {
    return new Response('Body is not JSON.', { status: 400 });
  }

  const status = statusForEvent(payload.type);
  const messageId = payload.data?.email_id;

  // An event type we do not act on, or one carrying no message id, is acknowledged rather
  // than retried forever. Returning 200 is what tells Svix to stop.
  if (!status || !messageId) {
    return Response.json({ ok: true, ignored: payload.type });
  }

  const detail =
    payload.data?.bounce?.message ?? payload.data?.bounce?.subType ?? payload.data?.reason ?? null;

  const applied = await getDb().transaction(async (tx) => {
    const found = await applyDeliveryEvent(tx, messageId, status, detail);
    if (!found) return null;

    // Out-of-order delivery is normal — Resend makes no ordering promise — and a late
    // `email.sent` must never overwrite a `bounced`, which is the status the firm needs.
    if (!shouldReplaceStatus(found.previous, status)) {
      await applyDeliveryEvent(tx, messageId, found.previous, detail);
      return { ...found, skipped: true };
    }

    // Only outcomes a firm would want to see in the history get an audit event; a
    // `delivered` for every reminder would drown the chain that Phase 5 exports.
    if (status === 'bounced' || status === 'complained' || status === 'failed') {
      const rows = await tx
        .select({ firmId: requestTable.firmId })
        .from(requestTable)
        .where(eq(requestTable.id, found.requestId))
        .limit(1);

      if (rows[0]) {
        await appendAuditEvent(tx, {
          action: `reminder.${status}`,
          actorType: 'system',
          firmId: rows[0].firmId,
          requestId: found.requestId,
          targetType: 'reminder_log',
          targetId: found.id,
          metadata: { providerMessageId: messageId, detail },
        });
      }
    }

    return { ...found, skipped: false };
  });

  if (!applied) {
    // A message id we have no row for. Someone else's webhook, a replay from a previous
    // install, or a message sent before this database existed.
    logger.debug('Resend webhook referenced an unknown message', { messageId });
    return Response.json({ ok: true, matched: false });
  }

  logger.info('applied a Resend delivery event', {
    event: payload.type,
    status,
    previous: applied.previous,
    skipped: applied.skipped,
  });

  return Response.json({ ok: true, matched: true });
}
