import { headers } from 'next/headers';

export interface RequestContext {
  ip: string | null;
  ua: string | null;
}

/**
 * Caller identity for the audit log.
 *
 * Behind a reverse proxy the socket address is the proxy, so `x-forwarded-for` is
 * preferred. It is attacker-controllable when Gather is exposed directly, so it is only
 * ever recorded — never used for an access-control decision. Phase 6 adds an explicit
 * trusted-proxy configuration.
 */
export async function requestContext(): Promise<RequestContext> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  const ip = forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : headerList.get('x-real-ip');
  return { ip, ua: headerList.get('user-agent') };
}
