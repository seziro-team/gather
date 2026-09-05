import { env } from '@gather/core';
import { consume, getDb, THROTTLE_RULES, type ThrottleScope } from '@gather/db';
import { logger } from './logger';

/**
 * Rate limiting, as the request paths use it.
 *
 * Two decisions worth stating.
 *
 * **The subject is a session, not an IP, wherever a session exists.** A family sharing a
 * router, an office behind one NAT, or a whole country behind a carrier-grade NAT are all
 * one IP address, and limiting them as one person means the product breaks for exactly the
 * clients least able to work around it. IP is used only where there is no session yet —
 * magic-link redemption — which is also the only place where the thing being limited is
 * guessing.
 *
 * **A limiter that cannot reach its store must not lock everybody out.** If the database is
 * unavailable the request is allowed and the failure is logged loudly. Gather is
 * self-hosted by firms whose alternative is email attachments; an outage that turns into a
 * lockout is a worse outcome than a minute of unlimited requests, and the database being
 * down means nothing else works anyway.
 */

export interface Limited {
  ok: boolean;
  retryAfter: number;
  remaining: number;
  resetAt: Date;
}

const ALLOWED: Limited = {
  ok: true,
  retryAfter: 0,
  remaining: Number.MAX_SAFE_INTEGER,
  resetAt: new Date(0),
};

/**
 * Limit a caller who may or may not be identifiable.
 *
 * Picks the per-IP rule when a trusted header named them and the shared ceiling when
 * nothing did, so the scope that gets applied always matches the confidence there is in
 * who is asking.
 */
export async function limitCaller(
  scope: 'portal.open',
  caller: Caller,
): Promise<{ limited: Limited; scope: ThrottleScope }> {
  const applied: ThrottleScope = caller.identified ? scope : `${scope}.shared`;
  return { limited: await limit(applied, caller.subject), scope: applied };
}

export async function limit(scope: ThrottleScope, subject: string): Promise<Limited> {
  const config = env();
  if (!config.GATHER_RATE_LIMIT) return ALLOWED;

  const rule = THROTTLE_RULES[scope];
  const bucket = `${scope}:${subject}`;

  try {
    const verdict = await consume(getDb(), bucket, rule);
    if (!verdict.allowed) {
      // Worth a log line: a client hitting a limit is either an attack or a limit set too
      // low, and both need somebody to look.
      logger.warn('rate limit reached', { scope, remaining: 0, retryAfter: verdict.retryAfter });
    }
    return {
      ok: verdict.allowed,
      retryAfter: verdict.retryAfter,
      remaining: verdict.remaining,
      resetAt: verdict.resetAt,
    };
  } catch (error) {
    logger.error('the rate limiter could not reach the database — allowing the request', {
      scope,
      error: (error as Error).message,
    });
    return ALLOWED;
  }
}

/**
 * The client's address, as far as it can be known.
 *
 * `X-Forwarded-For` is only believed when `GATHER_TRUST_PROXY` is on, because otherwise
 * anyone can set it and choose which rate-limit bucket they land in — which would make the
 * limit a formality. With it off, an install behind a proxy sees every request as coming
 * from the proxy, which is a visible, fixable problem rather than a silent bypass.
 */
export interface Caller {
  /** The bucket subject. `shared` when the client could not be told apart from any other. */
  subject: string;
  /** False when no trusted header identified them — see the note below. */
  identified: boolean;
}

export function clientAddress(headers: Headers): Caller {
  if (env().GATHER_TRUST_PROXY) {
    const forwarded = headers.get('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first) return { subject: first, identified: true };

    const real = headers.get('x-real-ip')?.trim();
    if (real) return { subject: real, identified: true };
  }

  // Next does not expose the socket address to a route handler, so without a trusted
  // forwarded header Gather genuinely cannot tell one client from another.
  //
  // The tempting thing is to apply the per-IP limit to everybody anyway. That is worse
  // than no limit: a firm sending thirty organizers in January would have its own clients
  // locked out by each other, and the failure would look like Gather being broken. So an
  // unidentified caller lands in one shared bucket with a much higher ceiling — bounded,
  // logged, and far above any plausible amount of real use.
  return { subject: 'shared', identified: false };
}

/**
 * RFC 9239-style headers, plus the `Retry-After` every HTTP client already understands.
 *
 * Sent on the refusal rather than on every response: a client that is nowhere near a limit
 * does not need to be told about it, and these are the headers somebody debugging a 429
 * will look for.
 */
export function limitHeaders(limited: Limited, scope: ThrottleScope): Record<string, string> {
  return {
    'Retry-After': String(limited.retryAfter),
    'RateLimit-Limit': String(THROTTLE_RULES[scope].max),
    'RateLimit-Remaining': String(limited.remaining),
    'RateLimit-Reset': String(limited.retryAfter),
  };
}

/** The 429 itself, in words a client can act on. */
export function tooManyRequests(limited: Limited, scope: ThrottleScope): Response {
  return new Response(
    `Too many requests. Try again in ${limited.retryAfter} second${limited.retryAfter === 1 ? '' : 's'}.`,
    { status: 429, headers: { ...limitHeaders(limited, scope), 'Content-Type': 'text/plain' } },
  );
}
