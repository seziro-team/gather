import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@gather/core';
import { openPortalLink, portalPath, PORTAL_COOKIE } from '@/lib/portal';

/**
 * The magic link a client clicks.
 *
 * Exchanging the token for a session and then redirecting means the token appears once, in
 * one request, and never again — not in the address bar of the page the client sits on for
 * ten minutes, not in a screenshot they send to their accountant, and not in the `Referer`
 * of anything the page loads.
 */

export const dynamic = 'force-dynamic';

const REASONS = {
  unknown: 'not-found',
  revoked: 'revoked',
  expired: 'expired',
  archived: 'archived',
} as const;

export async function GET(
  _request: NextRequest,
  context: RouteContext<'/p/[token]'>,
): Promise<Response> {
  const { token } = await context.params;
  const config = env();

  const opened = await openPortalLink(token);
  if (!opened.ok) {
    return NextResponse.redirect(
      new URL(`/portal/unavailable?reason=${REASONS[opened.reason]}`, config.GATHER_APP_URL),
    );
  }

  const destination = new URL(portalPath(opened.requestId), config.GATHER_APP_URL);
  const response = NextResponse.redirect(destination);

  response.cookies.set({
    name: PORTAL_COOKIE,
    value: opened.sessionSecret,
    httpOnly: true,
    // Scoped to this one request, so no other part of Gather ever receives it and a
    // client can have two portals open at once without them fighting over a cookie.
    path: portalPath(opened.requestId),
    sameSite: 'lax',
    secure: destination.protocol === 'https:',
    expires: opened.expiresAt,
  });

  return response;
}
