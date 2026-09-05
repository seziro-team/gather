import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database, DbTransaction } from './client.js';
import { accessToken, portalSession, request } from './schema/gather.js';

/**
 * Magic links and the sessions they create — plan.md §6.
 *
 * The client side of Gather has no accounts, so this is the whole authentication story for
 * a person uploading their tax documents. Two rules shape it:
 *
 *  1. **Nothing reusable is stored.** The link token and the session secret exist in the
 *     operator's email and the client's cookie jar; the database holds SHA-256 of each.
 *     A dump of `access_token` lets nobody open anybody's portal.
 *  2. **A credential is scoped to one request.** Not to a client, not to a firm. The
 *     blast radius of a forwarded email is that one checklist.
 *
 * SHA-256 rather than a password hash on purpose: these are 256-bit random strings, not
 * secrets a person chose. There is no dictionary to attack, and a lookup on every portal
 * page load should not cost an Argon2 pass.
 */

const TOKEN_BYTES = 32;

/** URL-safe and short enough to survive an email client's line wrapping. */
export function generateSecret(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export type AccessTokenRow = typeof accessToken.$inferSelect;
export type PortalSessionRow = typeof portalSession.$inferSelect;

export interface IssuedLink {
  id: string;
  /** Returned exactly once. Gather cannot show it again, and does not try. */
  secret: string;
  expiresAt: Date;
}

export async function issueAccessToken(
  tx: DbTransaction,
  input: { requestId: string; expiresAt: Date; createdBy?: string | null },
): Promise<IssuedLink> {
  const secret = generateSecret();
  const inserted = await tx
    .insert(accessToken)
    .values({
      requestId: input.requestId,
      tokenHash: hashSecret(secret),
      purpose: 'portal',
      expiresAt: input.expiresAt,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: accessToken.id, expiresAt: accessToken.expiresAt });

  const row = inserted[0];
  if (!row) throw new Error('access token insert returned no row');
  return { id: row.id, secret, expiresAt: row.expiresAt };
}

export type LinkRejection = 'unknown' | 'revoked' | 'expired' | 'archived';

export type RedeemResult =
  | {
      ok: true;
      requestId: string;
      tokenId: string;
      /** The portal session cookie value. Also returned exactly once. */
      sessionSecret: string;
      expiresAt: Date;
    }
  | { ok: false; reason: LinkRejection };

/**
 * Exchange a link for a session.
 *
 * The link stays usable until it expires or is revoked — a client who closes the browser,
 * or opens the same email on a second device, must not be locked out by having clicked
 * once. That is a deliberate difference from a single-use token: the thing being protected
 * is a checklist the client is meant to keep coming back to, and every use is logged.
 */
export async function redeemAccessToken(
  tx: DbTransaction,
  secret: string,
  input: { ip?: string | null; ua?: string | null; sessionHours: number; now?: Date },
): Promise<RedeemResult> {
  const now = input.now ?? new Date();

  const rows = await tx
    .select({ token: accessToken, status: request.status })
    .from(accessToken)
    .innerJoin(request, eq(request.id, accessToken.requestId))
    .where(eq(accessToken.tokenHash, hashSecret(secret)))
    .limit(1);

  const found = rows[0];
  if (!found) return { ok: false, reason: 'unknown' };
  if (found.token.revokedAt) return { ok: false, reason: 'revoked' };
  if (found.token.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (found.status === 'archived') return { ok: false, reason: 'archived' };

  const sessionSecret = generateSecret();
  const expiresAt = new Date(now.getTime() + input.sessionHours * 3_600_000);

  await tx.insert(portalSession).values({
    requestId: found.token.requestId,
    tokenId: found.token.id,
    sessionHash: hashSecret(sessionSecret),
    ip: input.ip ?? null,
    ua: input.ua ?? null,
    expiresAt,
  });

  await tx.update(accessToken).set({ lastUsedAt: now }).where(eq(accessToken.id, found.token.id));

  return {
    ok: true,
    requestId: found.token.requestId,
    tokenId: found.token.id,
    sessionSecret,
    expiresAt,
  };
}

export interface PortalIdentity {
  sessionId: string;
  tokenId: string;
  requestId: string;
}

/**
 * Resolve a session cookie against one request.
 *
 * The request id comes from the URL and is part of the lookup rather than something read
 * back off the row: a session for request A queried against request B finds nothing, which
 * is the cross-request check that makes the portal's IDOR story a query rather than an
 * `if` somebody can forget to write.
 */
export async function findPortalSession(
  db: Database | DbTransaction,
  requestId: string,
  sessionSecret: string,
  now: Date = new Date(),
): Promise<PortalIdentity | null> {
  const rows = await db
    .select({
      id: portalSession.id,
      tokenId: portalSession.tokenId,
      requestId: portalSession.requestId,
      expiresAt: portalSession.expiresAt,
      sessionHash: portalSession.sessionHash,
      tokenRevokedAt: accessToken.revokedAt,
      tokenExpiresAt: accessToken.expiresAt,
    })
    .from(portalSession)
    .innerJoin(accessToken, eq(accessToken.id, portalSession.tokenId))
    .where(
      and(
        eq(portalSession.sessionHash, hashSecret(sessionSecret)),
        eq(portalSession.requestId, requestId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt <= now) return null;

  // Revoking a link kills the sessions it produced. Otherwise "revoke" would mean
  // "stop new people getting in", which is not what an operator clicking it believes.
  if (row.tokenRevokedAt || row.tokenExpiresAt <= now) return null;

  // Cheap defence against a lookup that ever stops being an exact-match index scan.
  const expected = Buffer.from(hashSecret(sessionSecret), 'hex');
  const actual = Buffer.from(row.sessionHash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  return { sessionId: row.id, tokenId: row.tokenId, requestId: row.requestId };
}

/** Best-effort liveness marker. Never on the critical path of serving the portal. */
export async function touchPortalSession(db: Database, sessionId: string): Promise<void> {
  await db
    .update(portalSession)
    .set({ lastSeenAt: new Date() })
    .where(eq(portalSession.id, sessionId));
}

export async function revokeAccessToken(
  tx: DbTransaction,
  tokenId: string,
  requestId: string,
): Promise<AccessTokenRow | null> {
  const updated = await tx
    .update(accessToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(accessToken.id, tokenId),
        eq(accessToken.requestId, requestId),
        isNull(accessToken.revokedAt),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

export interface LinkSummary {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  opens: number;
}

export async function listAccessTokens(db: Database, requestId: string): Promise<LinkSummary[]> {
  return db
    .select({
      id: accessToken.id,
      createdAt: accessToken.createdAt,
      expiresAt: accessToken.expiresAt,
      revokedAt: accessToken.revokedAt,
      lastUsedAt: accessToken.lastUsedAt,
      opens: sql<number>`(
        select count(*)::int from ${portalSession}
        where ${portalSession.tokenId} = ${accessToken.id}
      )`,
    })
    .from(accessToken)
    .where(eq(accessToken.requestId, requestId))
    .orderBy(sql`${accessToken.createdAt} desc`);
}
