import { env } from '@gather/core';
import {
  approveItem,
  findReminderTarget,
  getDb,
  readReviewView,
  rejectItem,
  requiredNotApproved,
  type ReviewResult,
  type ReviewView,
} from '@gather/db';
import { getMail, mailConfigured, renderReminderEmail } from '@gather/mail';
import { requirePermission, type Actor } from './actor';
import { logger } from './logger';
import { getRequest } from './requests';

/**
 * The firm's review, from the web app's side.
 *
 * Every entry point re-reads the request through `getRequest`, which is firm-scoped in the
 * query — so an item id from another firm's request has nothing to attach to, and the
 * check is not something a future caller can forget to do.
 */

export async function readReview(requestId: string): Promise<ReviewView> {
  return readReviewView(getDb(), requestId);
}

export type ReviewOutcome = { ok: true; result: ReviewResult } | { ok: false; error: string };

export async function approve(
  actor: Actor,
  requestId: string,
  itemId: string,
): Promise<ReviewOutcome> {
  requirePermission(actor, 'requests:review');
  const owned = await getRequest(actor.firmId, requestId);
  if (!owned) return { ok: false, error: 'Request not found.' };

  try {
    const result = await getDb().transaction((tx) =>
      approveItem(tx, requestId, itemId, {
        firmId: actor.firmId,
        actorId: actor.actorId,
        ip: actor.context.ip,
        ua: actor.context.ua,
      }),
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Send one item back, and tell the client.
 *
 * The email is sent *after* the transaction commits, not inside it. A mail server that
 * hangs must not hold a database transaction open, and a rejection that is recorded but
 * whose email failed is recoverable — the item is visibly outstanding on the portal, and
 * the next scheduled reminder will list it. The reverse (an email sent for a rejection
 * that rolled back) would tell a client to fix something the firm never sent back.
 */
export async function reject(
  actor: Actor,
  requestId: string,
  itemId: string,
  note: string,
): Promise<ReviewOutcome> {
  requirePermission(actor, 'requests:review');
  const owned = await getRequest(actor.firmId, requestId);
  if (!owned) return { ok: false, error: 'Request not found.' };

  let result: ReviewResult;
  try {
    result = await getDb().transaction((tx) =>
      rejectItem(tx, requestId, itemId, note, {
        firmId: actor.firmId,
        actorId: actor.actorId,
        ip: actor.context.ip,
        ua: actor.context.ua,
      }),
    );
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  await notifyRejection(actor.firmId, requestId).catch((error: unknown) => {
    // Logged, not surfaced: the rejection itself succeeded, and telling the firm their
    // decision failed because an SMTP server was slow would be wrong.
    logger.warn('could not email the client about a rejected item', {
      requestId,
      error: (error as Error).message,
    });
  });

  return { ok: true, result };
}

/**
 * Tell the client something needs another look.
 *
 * Branded from the same snapshot the reminders use, so a rejection notice and a reminder
 * for the same request cannot look like they came from different firms.
 */
async function notifyRejection(firmId: string, requestId: string): Promise<void> {
  if (!mailConfigured()) return;

  const target = await findReminderTarget(getDb(), requestId, firmId);
  if (!target || !target.clientEmail.trim()) return;

  const view = await readReviewView(getDb(), requestId);
  const outstanding = view.sections
    .flatMap((section) => section.items)
    .filter((entry) => entry.status !== 'approved')
    .map((entry) => entry.item.label);

  const snapshot = (target.brandSnapshot ?? null) as {
    name?: string;
    logoUrl?: string | null;
    brandColor?: string;
  } | null;

  const email = renderReminderEmail({
    brand: {
      firmName: snapshot?.name ?? target.firmName,
      color: snapshot?.brandColor ?? target.firmColor,
      logoUrl: snapshot?.logoUrl ?? target.firmLogoUrl,
    },
    clientName: target.clientName,
    requestTitle: target.requestTitle,
    portalUrl: new URL(`/portal/${requestId}`, env().GATHER_APP_URL).toString(),
    outstanding,
    totalItems: view.total,
    dueAt: target.dueAt,
    // Never the "here is a new request" wording: the client already has it, and one item
    // has come back.
    reminderNumber: Math.max(1, target.sentCount),
  });

  const sent = await getMail().send({
    to: target.clientEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: { 'X-Gather-Request': requestId },
  });

  logger.info('told the client an item was sent back', {
    requestId,
    providerMessageId: sent.providerMessageId,
  });
}

export async function outstandingRequired(requestId: string): Promise<number> {
  return requiredNotApproved(getDb(), requestId);
}
