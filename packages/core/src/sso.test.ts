import { describe, expect, it } from 'vitest';
import {
  passwordSignInAllowed,
  ssoConfig,
  ssoSignInAllowed,
  twoFactorRequired,
  type SsoSettings,
} from './sso.js';

/**
 * The SSO rules, without a provider.
 *
 * Everything here is a decision somebody will be asked to justify — who gets in, whether a
 * password still works, whether the IdP counts as MFA — so each one is pinned to a test
 * rather than to a paragraph in a README. The OIDC exchange itself is Better Auth's and is
 * proved end to end against a real Keycloak in `e2e/sso.spec.ts`.
 */

const off: SsoSettings = {
  providerName: 'your organisation',
  scopes: 'openid profile email',
  enforced: false,
  satisfiesTwoFactor: true,
  autoJoin: false,
  defaultRole: 'member',
};

const on: SsoSettings = {
  ...off,
  issuerUrl: 'https://login.example.com/realms/staff',
  clientId: 'gather',
  clientSecret: 'shhh',
};

describe('configuration', () => {
  it('is off until an issuer, a client id and a secret are all present', () => {
    expect(ssoConfig(off)).toBeNull();
    expect(ssoConfig({ ...on, clientSecret: undefined })).toBeNull();
    expect(ssoConfig({ ...on, clientId: undefined })).toBeNull();
    expect(ssoConfig({ ...on, issuerUrl: undefined })).toBeNull();
  });

  it('builds the discovery URL rather than asking somebody to paste it', () => {
    // Every OIDC provider serves it at this path. Asking for the full URL is asking for a
    // typo in the one string that decides whether anyone can sign in.
    expect(ssoConfig(on)?.discoveryUrl).toBe(
      'https://login.example.com/realms/staff/.well-known/openid-configuration',
    );
    expect(
      ssoConfig({ ...on, issuerUrl: 'https://login.example.com/realms/staff///' })?.discoveryUrl,
    ).toBe('https://login.example.com/realms/staff/.well-known/openid-configuration');
  });

  it('trims trailing slashes in linear time, however many there are', () => {
    // CodeQL flagged the regex this replaced as polynomial-backtracking. 100k slashes is
    // not a realistic configuration; it is the shape of input that used to make the engine
    // retry every split point, and the assertion is that it now does not.
    const started = Date.now();
    const absurd = `https://login.example.com/realms/staff${'/'.repeat(100_000)}`;
    expect(ssoConfig({ ...on, issuerUrl: absurd })?.issuer).toBe(
      'https://login.example.com/realms/staff',
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('splits scopes on whitespace or commas, because both get typed', () => {
    expect(ssoConfig(on)?.scopes).toEqual(['openid', 'profile', 'email']);
    expect(ssoConfig({ ...on, scopes: 'openid, profile , email,groups' })?.scopes).toEqual([
      'openid',
      'profile',
      'email',
      'groups',
    ]);
  });
});

describe('passwords', () => {
  it('stay available unless SSO is configured *and* enforced', () => {
    expect(passwordSignInAllowed(off)).toBe(true);
    expect(passwordSignInAllowed(on)).toBe(true);
    expect(passwordSignInAllowed({ ...on, enforced: true })).toBe(false);
  });

  it('stay available when enforcement is set without a provider', () => {
    // The env schema refuses this combination at boot. Belt and braces: if it ever got
    // through, the failure mode must be "passwords still work", not "nobody can sign in".
    expect(passwordSignInAllowed({ ...off, enforced: true })).toBe(true);
  });
});

describe('who may sign in', () => {
  it('refuses when no provider is configured', () => {
    expect(ssoSignInAllowed(off, 'someone@example.com')).toEqual({
      ok: false,
      reason: 'not-configured',
    });
  });

  it('refuses an identity with no email address', () => {
    // Gather identifies people by email everywhere — invitations, audit rows, reminders.
    // A provider that will not release the claim cannot be used, and saying so is more
    // useful than a login loop.
    for (const email of [null, undefined, '', '   ', 'not-an-email']) {
      expect(ssoSignInAllowed(on, email)).toEqual({ ok: false, reason: 'no-email' });
    }
  });

  it('accepts anyone the provider vouches for when no domain list is set', () => {
    expect(ssoSignInAllowed(on, 'anyone@anywhere.example')).toEqual({ ok: true });
  });

  it('honours the domain list, case and whitespace aside', () => {
    const scoped = { ...on, allowedDomains: '@delgado.example.com, @okafor.example.com' };
    expect(ssoSignInAllowed(scoped, 'dana@Delgado.Example.com ')).toEqual({ ok: true });
    expect(ssoSignInAllowed(scoped, 'someone@elsewhere.example')).toEqual({
      ok: false,
      reason: 'domain-not-allowed',
    });
  });

  it('cannot be fooled by an allowed domain inside the local part', () => {
    // `"@delgado.example.com"@evil.test` is a legal address whose domain is evil.test.
    // Matching on the last @ is what makes that a rejection rather than a way in.
    const scoped = { ...on, allowedDomains: '@delgado.example.com' };
    expect(ssoSignInAllowed(scoped, '"@delgado.example.com"@evil.test')).toEqual({
      ok: false,
      reason: 'domain-not-allowed',
    });
    expect(ssoSignInAllowed(scoped, 'x@evil.test?@delgado.example.com.evil.test')).toEqual({
      ok: false,
      reason: 'domain-not-allowed',
    });
  });
});

describe('the second factor', () => {
  it('is not asked for at all when the install does not require one', () => {
    expect(twoFactorRequired(off, { requireTwoFactor: false, signedInThroughSso: false })).toBe(
      false,
    );
  });

  it('is still required of a password account, even where SSO exists', () => {
    expect(twoFactorRequired(on, { requireTwoFactor: true, signedInThroughSso: false })).toBe(true);
    expect(
      twoFactorRequired(
        { ...on, enforced: true },
        { requireTwoFactor: true, signedInThroughSso: false },
      ),
    ).toBe(true);
  });

  it('is waived only when SSO is enforced and the provider is trusted to do MFA', () => {
    const enforced = { ...on, enforced: true };
    expect(twoFactorRequired(enforced, { requireTwoFactor: true, signedInThroughSso: true })).toBe(
      false,
    );
    // Explicitly told the provider does not do MFA: Gather asks for it after all.
    expect(
      twoFactorRequired(
        { ...enforced, satisfiesTwoFactor: false },
        { requireTwoFactor: true, signedInThroughSso: true },
      ),
    ).toBe(true);
  });

  it('is still required when SSO is offered but not enforced', () => {
    // Optional SSO means a password is also a way in, so the IdP is not the only gate and
    // cannot stand in for the second factor.
    expect(twoFactorRequired(on, { requireTwoFactor: true, signedInThroughSso: true })).toBe(true);
  });
});
