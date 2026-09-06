import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env, twoFactorRequired } from '@gather/core';
import { getAuth, signedInThroughSso, ssoSettings } from './auth';
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
  if (result.user.twoFactorEnabled) return result;

  // On an install that enforces SSO, the identity provider has already authenticated this
  // person and is where the enterprise actually administers MFA. Asking for a second TOTP
  // on top is not more security — it is a second secret kept in the same password manager.
  // Every other case is unchanged: a password account still has to set one up.
  const sso = ssoSettings();
  const throughSso = sso.enforced ? await signedInThroughSso(result.user.id) : false;

  if (
    twoFactorRequired(sso, {
      requireTwoFactor: env().GATHER_REQUIRE_2FA,
      signedInThroughSso: throughSso,
    })
  ) {
    redirect('/account/security?required=1');
  }

  return result;
}
