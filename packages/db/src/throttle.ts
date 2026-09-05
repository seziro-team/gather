import { lt, sql } from 'drizzle-orm';
import type { Database, DbTransaction } from './client.js';
import { throttle } from './schema/gather.js';

/**
 * Rate limiting, in Postgres.
 *
 * plan.md §6 asks for limits per token, per IP and per account. The store is the database
 * rather than process memory for the reason that makes an in-memory limiter useless: it
 * resets on every restart and is not shared between replicas, so "five attempts a minute"
 * becomes five per container per deploy.
 *
 * A **fixed window**, not a token bucket. One atomic statement, easy to reason about when
 * you are the one being limited, and its worst case — twice the limit across a window
 * boundary — is irrelevant at the scale these limits protect against. A token bucket would
 * be smoother and would need either a row lock or a read-modify-write, and neither is worth
 * it to stop somebody guessing magic links.
 */

export interface ThrottleRule {
  /** Requests permitted per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface ThrottleVerdict {
  allowed: boolean;
  /** How many more requests are permitted in this window. */
  remaining: number;
  /** Seconds until the window resets — the `Retry-After` value. */
  retryAfter: number;
  /** When the current window ends, for `RateLimit-Reset`. */
  resetAt: Date;
}

/**
 * Count one request against a bucket, and say whether it may proceed.
 *
 * The whole thing is a single `INSERT … ON CONFLICT DO UPDATE`: the `CASE` starts a new
 * window when the old one has expired and increments otherwise, so two requests arriving
 * at the same instant cannot both read "0 hits" and both be allowed. Getting that wrong is
 * how a rate limiter turns into a rate suggestion.
 */
export async function consume(
  db: Database | DbTransaction,
  bucket: string,
  rule: ThrottleRule,
  now: Date = new Date(),
): Promise<ThrottleVerdict> {
  const windowStart = new Date(now.getTime() - rule.windowSeconds * 1000);

  const rows = await db
    .insert(throttle)
    .values({ bucket, windowStartedAt: now, hits: 1 })
    .onConflictDoUpdate({
      target: throttle.bucket,
      set: {
        windowStartedAt: sql`case
          when ${throttle.windowStartedAt} <= ${windowStart.toISOString()}::timestamptz
          then ${now.toISOString()}::timestamptz
          else ${throttle.windowStartedAt}
        end`,
        hits: sql`case
          when ${throttle.windowStartedAt} <= ${windowStart.toISOString()}::timestamptz
          then 1
          else ${throttle.hits} + 1
        end`,
      },
    })
    .returning({ hits: throttle.hits, windowStartedAt: throttle.windowStartedAt });

  const row = rows[0]!;
  const resetAt = new Date(row.windowStartedAt.getTime() + rule.windowSeconds * 1000);
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));

  return {
    allowed: row.hits <= rule.max,
    remaining: Math.max(0, rule.max - row.hits),
    retryAfter,
    resetAt,
  };
}

/**
 * Look at a bucket without counting against it.
 *
 * Used by tests and by the retention report; deliberately not used on a request path,
 * where checking and counting have to be the same operation.
 */
export async function peek(
  db: Database | DbTransaction,
  bucket: string,
  rule: ThrottleRule,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({ hits: throttle.hits, windowStartedAt: throttle.windowStartedAt })
    .from(throttle)
    .where(sql`${throttle.bucket} = ${bucket}`)
    .limit(1);

  const row = rows[0];
  if (!row) return 0;
  const expired = row.windowStartedAt.getTime() <= now.getTime() - rule.windowSeconds * 1000;
  return expired ? 0 : row.hits;
}

/**
 * Delete buckets whose window closed long ago.
 *
 * Without this the table grows one row per distinct IP forever. Called by the retention
 * job; there is no TTL in Postgres to do it for us.
 */
export async function sweepThrottle(db: Database, olderThan: Date): Promise<number> {
  const deleted = await db
    .delete(throttle)
    .where(lt(throttle.windowStartedAt, olderThan))
    .returning({ bucket: throttle.bucket });
  return deleted.length;
}

/**
 * The limits Gather ships with.
 *
 * Deliberately generous for anything a real person does and tight on anything an attacker
 * would do in bulk. A client filling in a 25-item organizer on a phone triggers a lot of
 * autosaves; somebody guessing magic-link tokens triggers a lot of `/p/<token>` requests,
 * and only one of those two should ever see a 429.
 */
export const THROTTLE_RULES = {
  /**
   * Magic-link redemption, **per IP** — only reachable when `GATHER_TRUST_PROXY` is on and
   * something in front is setting a forwarded header. The token is 32 bytes of CSPRNG, so
   * guessing it is hopeless anyway; this turns "hopeless" into "measurably hopeless" and
   * makes the attempt visible in the audit log.
   */
  'portal.open': { max: 20, windowSeconds: 60 },
  /**
   * Magic-link redemption when the client **cannot be identified**.
   *
   * With no trusted proxy header, every request looks like it came from the same place, so
   * a per-IP limit is not available — and applying the per-IP number globally would mean a
   * firm sending thirty organizers in January locks its own clients out. This ceiling is
   * high enough that no plausible amount of real use reaches it and low enough that a
   * brute-force is still bounded and still shows up in the log.
   *
   * The real fix is to put a reverse proxy in front and turn `GATHER_TRUST_PROXY` on. The
   * README says so, and so does docs/threat-model.md.
   */
  'portal.open.shared': { max: 600, windowSeconds: 60 },
  /** Portal page loads for one session. A client refreshing is not an attack. */
  'portal.read': { max: 120, windowSeconds: 60 },
  /** Uploads per portal session. Twenty files a minute is a fast scanner, not a person. */
  'portal.upload': { max: 30, windowSeconds: 60 },
  /** Autosave writes per portal session — one per pause in typing, across every item. */
  'portal.save': { max: 240, windowSeconds: 60 },
  /** Signed file downloads, per session or per firm user. */
  'file.download': { max: 120, windowSeconds: 60 },
  /** Whole-request zips, which are expensive to build. */
  'request.download': { max: 10, windowSeconds: 60 },
  /** Audit exports, likewise. */
  'audit.export': { max: 10, windowSeconds: 60 },
} as const satisfies Record<string, ThrottleRule>;

export type ThrottleScope = keyof typeof THROTTLE_RULES;
