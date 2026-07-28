import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@gather/core';
import { getAuth } from './auth';
import { getMembership, type Membership } from './firm';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
}

/** Signed in, nothing more. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');
  return user;
}

/** Signed in and attached to a firm. Used by everything that touches firm data. */
export async function requireMembership(): Promise<{ user: SessionUser; membership: Membership }> {
  const user = await requireUser();
  const membership = await getMembership(user.id);
  if (!membership) redirect('/create-firm');
  return { user, membership };
}

/**
 * Signed in, attached to a firm, and holding a second factor when the install requires
 * one. This is the gate for anything that shows client data — the Safeguards Rule
 * expects MFA in front of customer information, not merely offered somewhere in settings.
 */
export async function requireReadyUser(): Promise<{ user: SessionUser; membership: Membership }> {
  const result = await requireMembership();
  if (env().GATHER_REQUIRE_2FA && !result.user.twoFactorEnabled) {
    redirect('/account/security?required=1');
  }
  return result;
}
