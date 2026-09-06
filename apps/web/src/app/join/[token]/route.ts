import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@gather/core';
import { passwordsEnabled, ssoEnabled } from '@/lib/auth';
import { getSessionUser } from '@/lib/session';
import { requestContext } from '@/lib/request-context';
import { join, lookupInvite } from '@/lib/team';

/**
 * Accepting an invitation to join a firm.
 *
 * Shaped like the portal's magic link and for the same reasons — the token appears in one
 * request and never again, so it is not left in an address bar or a screenshot. The
 * difference is what it does: this attaches an account to a firm, so the person has to be
 * signed in first.
 *
 * Somebody without an account is sent to sign up with the invitation remembered, so the
 * link still works for a colleague who has never heard of Gather.
 */

export const dynamic = 'force-dynamic';

const REASONS = {
  unknown: 'not-found',
  revoked: 'revoked',
  expired: 'expired',
  accepted: 'already-used',
} as const;

export async function GET(
  _request: NextRequest,
  context: RouteContext<'/join/[token]'>,
): Promise<Response> {
  const { token } = await context.params;
  const appUrl = env().GATHER_APP_URL;

  const invite = await lookupInvite(token);
  if (!invite.ok) {
    return NextResponse.redirect(
      new URL(`/join/unavailable?reason=${REASONS[invite.reason]}`, appUrl),
    );
  }

  const user = await getSessionUser();
  if (!user) {
    // Sign up or sign in, then come back here. The token stays in the URL rather than a
    // cookie so that finishing in a different tab still works.
    // Sign up (or sign in) carrying the invitation, so somebody who has never heard of
    // Gather can follow one link end to end.
    // Where a signed-out invitee goes depends on how this install lets people in.
    //
    // With SSO enforced there is no password to set, so a sign-up form would be a dead
    // end: they authenticate with the provider first and come back here, where the
    // invitation is accepted for the account they now have.
    if (!passwordsEnabled() && ssoEnabled()) {
      const next = encodeURIComponent(`/join/${token}`);
      return NextResponse.redirect(new URL(`/sign-in?next=${next}`, appUrl));
    }

    return NextResponse.redirect(new URL(`/sign-up?invite=${encodeURIComponent(token)}`, appUrl));
  }

  const accepted = await join(token, user.id, await requestContext());
  if (!accepted.ok) {
    return NextResponse.redirect(
      new URL(`/join/unavailable?reason=${REASONS[accepted.reason]}`, appUrl),
    );
  }

  return NextResponse.redirect(new URL('/dashboard?joined=1', appUrl));
}
