import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived signed download links — plan.md §6.
 *
 * A file is never reachable from a bare id. The link carries an expiry and an HMAC over
 * exactly what it grants, so a URL copied out of a browser's history, pasted into a chat,
 * or scraped from a proxy log stops working within minutes.
 *
 * The signature is not a substitute for a session: both routes that serve files check the
 * caller's session *and* the signature. This is the layer that limits what a leaked URL is
 * worth, not the layer that decides who may read a document.
 */

export interface DownloadGrant {
  fileId: string;
  /**
   * Who the link was minted for: `portal:<requestId>` for a client, `firm:<firmId>` for a
   * signed-in user. A portal link therefore cannot be replayed against the firm's route,
   * and one firm's link means nothing to another.
   */
  scope: string;
  /** Unix seconds. */
  expiresAt: number;
}

/** Bound to a version string so a future change to the format cannot be replayed as this one. */
function preimage(grant: DownloadGrant): string {
  return `gather-download-v1\n${grant.fileId}\n${grant.scope}\n${grant.expiresAt}`;
}

export function signDownload(secret: string, grant: DownloadGrant): string {
  return createHmac('sha256', secret).update(preimage(grant)).digest('hex');
}

export type DownloadCheck =
  { ok: true } | { ok: false; reason: 'expired' | 'signature' | 'malformed' };

export function verifyDownload(
  secret: string,
  grant: DownloadGrant,
  signature: string,
  now: Date = new Date(),
): DownloadCheck {
  if (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (!/^[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: 'malformed' };

  // Signature first, expiry second: checking expiry first would let anyone probe whether a
  // particular file id has an unexpired link outstanding.
  const expected = signDownload(secret, grant);
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) {
    return { ok: false, reason: 'signature' };
  }
  if (grant.expiresAt * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true };
}

export function expiryIn(seconds: number, now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000) + seconds;
}

/**
 * How long a download link lives. Long enough to click, short enough that a URL in a
 * screenshot or a support ticket is already dead.
 */
export const DOWNLOAD_LINK_SECONDS = 300;
