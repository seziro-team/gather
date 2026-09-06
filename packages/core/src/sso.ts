/**
 * Single sign-on policy.
 *
 * The decisions, separated from the plumbing: who is allowed in, whether a password is
 * still an option, and whether the identity provider counts as the second factor. They
 * live here — pure, no database, no Better Auth — because every one of them is a rule an
 * auditor will ask about, and a rule you can read in fifteen lines is a rule you can
 * answer for.
 *
 * The plumbing (discovery, PKCE, the token exchange) is Better Auth's `genericOAuth`
 * plugin against the provider's own discovery document. Gather does not implement OIDC.
 */

/** The provider id Gather registers with Better Auth. Appears in the `account` table. */
export const SSO_PROVIDER_ID = 'sso';

export interface SsoSettings {
  issuerUrl?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  providerName: string;
  scopes: string;
  allowedDomains?: string | undefined;
  enforced: boolean;
  satisfiesTwoFactor: boolean;
  autoJoin: boolean;
  defaultRole: 'member' | 'admin';
}

export interface SsoConfig {
  providerId: typeof SSO_PROVIDER_ID;
  discoveryUrl: string;
  /**
   * The issuer, normalised.
   *
   * Not passed to Better Auth: since 1.7 it takes the issuer from the discovery document
   * and verifies ID tokens against the JWKS advertised there, which is stricter than a
   * string we supplied. Kept because it is what the operator configured, and what an error
   * message has to name when discovery cannot be reached.
   */
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  providerName: string;
}

/**
 * The provider Gather should offer, or `null` when none is configured.
 *
 * `null` is the self-hosted default and is not a degraded state: a firm running Gather for
 * itself signs in with a password and a TOTP code, and nothing here runs at all.
 */
export function ssoConfig(settings: SsoSettings): SsoConfig | null {
  const { issuerUrl, clientId, clientSecret } = settings;
  if (!issuerUrl || !clientId || !clientSecret) return null;

  const issuer = withoutTrailingSlashes(issuerUrl);
  return {
    providerId: SSO_PROVIDER_ID,
    // Built rather than configured: every OIDC provider serves discovery at this path, and
    // asking an operator to paste the full URL is asking them to paste it wrong.
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    issuer,
    clientId,
    clientSecret,
    scopes: settings.scopes.split(/[\s,]+/).filter(Boolean),
    providerName: settings.providerName,
  };
}

/**
 * Trim trailing slashes, without a regular expression.
 *
 * `replace(/\/+$/, '')` reads better and is a polynomial-backtracking ReDoS: an input of
 * many slashes makes the engine retry every split point. Reachable only from an operator's
 * own configuration here, so the practical risk was small — but CodeQL was right to flag it,
 * and a loop is both faster and impossible to get wrong.
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

/**
 * Whether email and password sign-in is still available.
 *
 * False only when SSO is both configured and enforced. Enforcing without a provider is
 * refused at boot — see the env schema — so this cannot lock everybody out.
 */
export function passwordSignInAllowed(settings: SsoSettings): boolean {
  return !(settings.enforced && ssoConfig(settings) !== null);
}

export type SsoRejection = 'not-configured' | 'no-email' | 'domain-not-allowed';

export const SSO_REJECTION_MESSAGES: Record<SsoRejection, string> = {
  'not-configured': 'Single sign-on is not set up on this Gather install.',
  'no-email':
    'Your identity provider did not send an email address. Gather identifies people by ' +
    'email, so it cannot sign you in without one — ask whoever administers it to release ' +
    'the `email` claim.',
  'domain-not-allowed':
    'That account is not on a domain this install accepts. If you think it should be, ' +
    'whoever runs this Gather can add your domain to SSO_ALLOWED_DOMAINS.',
};

/**
 * Whether this identity may sign in.
 *
 * The domain list is the difference between "our staff" and "anyone with an account at a
 * shared identity provider". An empty list means the provider is trusted for everyone it
 * vouches for, which is right for a tenant that only holds your own people.
 */
export function ssoSignInAllowed(
  settings: SsoSettings,
  email: string | null | undefined,
): { ok: true } | { ok: false; reason: SsoRejection } {
  if (ssoConfig(settings) === null) return { ok: false, reason: 'not-configured' };

  const address = email?.trim().toLowerCase() ?? '';
  if (!address.includes('@')) return { ok: false, reason: 'no-email' };

  const allowed = (settings.allowedDomains ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return { ok: true };

  // Compared against the last @ so that a local part containing one — which is legal —
  // cannot smuggle an allowed domain past the check.
  const domain = address.slice(address.lastIndexOf('@'));
  return allowed.includes(domain) ? { ok: true } : { ok: false, reason: 'domain-not-allowed' };
}

/**
 * Whether a second factor still has to be set up in Gather.
 *
 * When SSO is enforced and the person signed in through the provider, the provider has
 * already authenticated them — and it is the thing an enterprise actually administers MFA
 * in. Demanding a second TOTP on top is not additional security; it is a second secret for
 * somebody to keep in the same password manager.
 *
 * Everyone else — a local account on a self-hosted install, or a password account on an
 * install that also offers SSO — is unaffected.
 */
export function twoFactorRequired(
  settings: SsoSettings,
  options: { requireTwoFactor: boolean; signedInThroughSso: boolean },
): boolean {
  if (!options.requireTwoFactor) return false;
  if (!options.signedInThroughSso) return true;
  if (!settings.enforced) return true;
  return !settings.satisfiesTwoFactor;
}
