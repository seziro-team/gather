import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { env } from '@gather/core';
import {
  appendAuditEvent,
  client,
  findPortalSession,
  firm,
  getDb,
  issueAccessToken,
  listAccessTokens,
  redeemAccessToken,
  request,
  revokeAccessToken,
  touchPortalSession,
  type LinkRejection,
  type LinkSummary,
} from '@gather/db';
import { requirePermission, type Actor } from './actor';
import { requestContext, type RequestContext } from './request-context';

/**
 * The client side of Gather: a link, a cookie, and one request's worth of access.
 *
 * The cookie is scoped by path to `/portal/<requestId>` rather than to the whole site.
 * Two things follow, both wanted:
 *
 *  - A client with two open requests can work on both at once, in one browser, because
 *    the browser treats them as two cookies.
 *  - Nothing else Gather serves ever receives a portal cookie. The firm's dashboard, the
 *    auth endpoints and every API route are outside its path, so a portal session cannot
 *    be replayed anywhere it was not issued for.
 */

export const PORTAL_COOKIE = 'gather_portal';

export function portalPath(requestId: string): string {
  return `/portal/${requestId}`;
}

export function portalLinkUrl(secret: string): string {
  return new URL(`/p/${secret}`, env().GATHER_APP_URL).toString();
}

export type PortalRequest = typeof request.$inferSelect;
export type PortalClient = typeof client.$inferSelect;
export type PortalFirm = typeof firm.$inferSelect;

export interface PortalContext {
  sessionId: string;
  tokenId: string;
  request: PortalRequest;
  client: PortalClient;
  firm: PortalFirm;
  context: RequestContext;
}

/**
 * Resolve the caller's portal session for one request, or `null`.
 *
 * Every portal page and route starts here. The request id comes from the URL and is part
 * of the session lookup, so a valid session for a different request resolves to nothing
 * rather than to somebody else's checklist.
 */
export async function currentPortal(requestId: string): Promise<PortalContext | null> {
  const jar = await cookies();
  const secret = jar.get(PORTAL_COOKIE)?.value;
  if (!secret) return null;

  const db = getDb();
  const identity = await findPortalSession(db, requestId, secret);
  if (!identity) return null;

  const rows = await db
    .select({ request, client, firm })
    .from(request)
    .innerJoin(client, eq(client.id, request.clientId))
    .innerJoin(firm, eq(firm.id, request.firmId))
    .where(eq(request.id, identity.requestId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Liveness only, and never worth failing a page render over.
  await touchPortalSession(db, identity.sessionId).catch(() => undefined);

  return {
    sessionId: identity.sessionId,
    tokenId: identity.tokenId,
    request: row.request,
    client: row.client,
    firm: row.firm,
    context: await requestContext(),
  };
}

export type OpenResult =
  | { ok: true; requestId: string; sessionSecret: string; expiresAt: Date }
  | { ok: false; reason: LinkRejection };

/**
 * Turn a magic link into a session.
 *
 * A rejected link is audited too. "Somebody tried a revoked link from this address at this
 * time" is exactly the sort of thing a firm needs when a client says they forwarded an
 * email to the wrong person.
 */
export async function openPortalLink(secret: string): Promise<OpenResult> {
  const context = await requestContext();
  const config = env();

  return getDb().transaction(async (tx) => {
    const redeemed = await redeemAccessToken(tx, secret, {
      ip: context.ip,
      ua: context.ua,
      sessionHours: config.GATHER_PORTAL_SESSION_HOURS,
    });

    if (!redeemed.ok) {
      // An unknown token identifies no request, so there is nothing to scope the event to
      // beyond the attempt itself. Recording the hash would let a later leak be matched
      // against it, so only the outcome is kept.
      await appendAuditEvent(tx, {
        action: 'portal.link_rejected',
        actorType: 'client',
        metadata: { reason: redeemed.reason },
        ip: context.ip,
        ua: context.ua,
      });
      return redeemed;
    }

    const rows = await tx
      .select({ firmId: request.firmId, status: request.status })
      .from(request)
      .where(eq(request.id, redeemed.requestId))
      .limit(1);
    const found = rows[0];

    // First time anyone opens it, the request starts moving. `sent` is set when the link
    // is created; this is the client actually arriving.
    if (found?.status === 'sent') {
      await tx
        .update(request)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(request.id, redeemed.requestId));
    }

    await appendAuditEvent(tx, {
      action: 'portal.opened',
      actorType: 'client',
      firmId: found?.firmId ?? null,
      requestId: redeemed.requestId,
      targetType: 'access_token',
      targetId: redeemed.tokenId,
      ip: context.ip,
      ua: context.ua,
    });

    return redeemed;
  });
}

export interface IssuedPortalLink {
  id: string;
  url: string;
  expiresAt: Date;
}

/**
 * Create a link for a client, and hand it back exactly once.
 *
 * Only the SHA-256 of the token is stored, so Gather genuinely cannot show it again — the
 * UI says so rather than offering a button that would have to lie. Issuing the first link
 * is what "sending" a request means until Phase 4 puts an email around it.
 */
export async function issuePortalLink(actor: Actor, requestId: string): Promise<IssuedPortalLink> {
  requirePermission(actor, 'requests:write');
  const config = env();
  const expiresAt = new Date(Date.now() + config.GATHER_PORTAL_LINK_DAYS * 86_400_000);

  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: request.id, status: request.status, sentAt: request.sentAt })
      .from(request)
      .where(and(eq(request.id, requestId), eq(request.firmId, actor.firmId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Request not found');
    if (row.status === 'archived') throw new Error('This request is archived.');

    const link = await issueAccessToken(tx, {
      requestId,
      expiresAt,
      createdBy: actor.actorId,
    });

    if (row.status === 'draft') {
      const brand = await tx
        .select({ name: firm.name, logoUrl: firm.logoUrl, brandColor: firm.brandColor })
        .from(firm)
        .where(eq(firm.id, actor.firmId))
        .limit(1);

      await tx
        .update(request)
        .set({
          status: 'sent',
          sentAt: new Date(),
          // Frozen now so that rebranding next year does not rewrite what this client saw.
          brandSnapshot: brand[0] ?? null,
          updatedAt: new Date(),
        })
        .where(eq(request.id, requestId));
    }

    await appendAuditEvent(tx, {
      action: 'request.link_issued',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      requestId,
      targetType: 'access_token',
      targetId: link.id,
      metadata: { expiresAt: expiresAt.toISOString() },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return { id: link.id, url: portalLinkUrl(link.secret), expiresAt: link.expiresAt };
  });
}

export async function revokePortalLink(
  actor: Actor,
  requestId: string,
  tokenId: string,
): Promise<void> {
  requirePermission(actor, 'requests:write');
  await getDb().transaction(async (tx) => {
    const owned = await tx
      .select({ id: request.id })
      .from(request)
      .where(and(eq(request.id, requestId), eq(request.firmId, actor.firmId)))
      .limit(1);
    if (owned.length === 0) throw new Error('Request not found');

    const revoked = await revokeAccessToken(tx, tokenId, requestId);
    if (!revoked) throw new Error('That link is already revoked.');

    await appendAuditEvent(tx, {
      action: 'request.link_revoked',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      requestId,
      targetType: 'access_token',
      targetId: tokenId,
      ip: actor.context.ip,
      ua: actor.context.ua,
    });
  });
}

export async function listPortalLinks(requestId: string): Promise<LinkSummary[]> {
  return listAccessTokens(getDb(), requestId);
}
