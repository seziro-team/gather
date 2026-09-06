import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { genericOAuth, twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { and, count, eq } from 'drizzle-orm';
import {
  env,
  passwordSignInAllowed,
  ssoConfig,
  ssoSignInAllowed,
  SSO_PROVIDER_ID,
  SSO_REJECTION_MESSAGES,
  type SsoSettings,
} from '@gather/core';
import {
  account as accountTable,
  firmUser,
  getDb,
  joinFirm,
  recordAuditEvent,
  schema,
  soleFirmId,
  user as userTable,
} from '@gather/db';

/**
 * Better Auth is constructed lazily.
 *
 * `next build` runs with no database and no secret, and route modules are imported
 * during the build. Constructing the auth instance at module scope would therefore
 * parse the environment at build time and fail. Everything here happens on the first
 * request instead.
 */
let instance: ReturnType<typeof createAuth> | null = null;

export function getAuth(): ReturnType<typeof createAuth> {
  instance ??= createAuth();
  return instance;
}

/**
 * Audit actions raised from the authentication layer.
 *
 * Sign-out is deliberately absent: this hook runs after the endpoint, by which point the
 * session is revoked and the actor is unknowable. `signOutAction` records it instead,
 * before revoking.
 */
export const AUTH_AUDIT_ACTIONS = {
  '/sign-up/email': 'auth.sign_up',
  '/sign-in/email': 'auth.sign_in',
  '/two-factor/enable': 'auth.two_factor.enable_requested',
  '/two-factor/verify-totp': 'auth.two_factor.verified',
  '/two-factor/verify-backup-code': 'auth.two_factor.backup_code_used',
  '/two-factor/disable': 'auth.two_factor.disabled',
} as const;

/**
 * What to record for a path, including the ones Better Auth registers as templates.
 *
 * The OIDC callback is declared as `/oauth2/callback/:providerId`, so `ctx.path` is the
 * template rather than the resolved URL — matching the literal `/oauth2/callback/sso`
 * silently recorded nothing, and an SSO install with no record of who signed in has given
 * up the thing the audit trail is for.
 */
function auditActionFor(path: string): string | null {
  if (path.startsWith('/oauth2/callback')) return 'auth.sso.sign_in';
  return AUTH_AUDIT_ACTIONS[path as keyof typeof AUTH_AUDIT_ACTIONS] ?? null;
}

/**
 * The SSO settings, read from the environment in one place.
 *
 * A function rather than a constant because `env()` parses lazily — see the note above
 * about `next build` running with no database and no secret.
 */
export function ssoSettings(): SsoSettings {
  const config = env();
  return {
    issuerUrl: config.SSO_ISSUER_URL,
    clientId: config.SSO_CLIENT_ID,
    clientSecret: config.SSO_CLIENT_SECRET,
    providerName: config.SSO_PROVIDER_NAME,
    scopes: config.SSO_SCOPES,
    allowedDomains: config.SSO_ALLOWED_DOMAINS,
    enforced: config.GATHER_SSO_ENFORCED,
    satisfiesTwoFactor: config.GATHER_SSO_SATISFIES_2FA,
    autoJoin: config.GATHER_SSO_AUTO_JOIN,
    defaultRole: config.GATHER_SSO_DEFAULT_ROLE,
  };
}

/** Whether this install offers a "sign in with…" button at all. */
export function ssoEnabled(): boolean {
  return ssoConfig(ssoSettings()) !== null;
}

/** What that button should say. */
export function ssoProviderName(): string {
  return ssoSettings().providerName;
}

/** Whether the password form should still be drawn. */
export function passwordsEnabled(): boolean {
  return passwordSignInAllowed(ssoSettings());
}

/**
 * Whether this account arrived through the identity provider.
 *
 * Read from the `account` table rather than from the session, because a session says how
 * somebody signed in *this time* and the question here is whether the provider owns this
 * identity at all. One indexed lookup, and only on installs that enforce SSO.
 */
export async function signedInThroughSso(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: accountTable.id })
    .from(accountTable)
    .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, SSO_PROVIDER_ID)))
    .limit(1);
  return rows.length > 0;
}

function clientAddress(headers: Headers): string | null {
  // Behind a reverse proxy the socket address is the proxy, so the forwarded header wins.
  // Phase 6 adds an explicit trusted-proxy setting; until then this is recorded as-is and
  // is treated as a hint, never as an access-control input.
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return headers.get('x-real-ip');
}

function createAuth() {
  const config = env();
  const db = getDb();
  const isHttps = config.GATHER_APP_URL.startsWith('https://');
  const sso = ssoSettings();
  const ssoProvider = ssoConfig(sso);

  return betterAuth({
    appName: 'Gather',
    baseURL: config.GATHER_APP_URL,
    secret: config.GATHER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg', schema }),

    emailAndPassword: {
      // Turned off entirely when SSO is enforced: joiners and leavers then live in one
      // place, and an account disabled in the provider cannot get in here through a
      // password nobody remembered to change.
      enabled: passwordSignInAllowed(sso),
      // Long passwords beat complexity rules. Email verification and password reset
      // arrive in Phase 4, when Gather has a real mail transport to send them with.
      minPasswordLength: 12,
      maxPasswordLength: 256,
      requireEmailVerification: false,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },

    account: {
      accountLinking: {
        // A person who already has a Gather account and then signs in through the provider
        // should land in the account they already have, not a second one holding none of
        // their firm's work.
        enabled: true,
        // Trusted only because the provider is the operator's own, named in the
        // environment. Linking on a provider anyone can register at would be an account
        // takeover: claim the victim's address there, sign in, inherit their firm.
        trustedProviders: ssoProvider ? [SSO_PROVIDER_ID] : [],
      },
    },

    advanced: {
      useSecureCookies: isHttps,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
      },
    },

    rateLimit: {
      enabled: config.GATHER_AUTH_RATE_LIMIT,
      // In Postgres, not in memory. In-memory limits reset on every restart and are not
      // shared between replicas, so "five sign-in attempts a minute" was really five per
      // container per deploy — which is not a limit. See migration 0004.
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 300, max: 3 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
      },
    },

    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            // An account arriving through the provider is governed by the domain list,
            // not by GATHER_ALLOW_SIGNUP: closing sign-ups is about strangers finding the
            // install, and somebody your identity provider already vouches for is not one.
            if (ssoProvider) {
              const verdict = ssoSignInAllowed(sso, data.email);
              if (!verdict.ok && verdict.reason !== 'not-configured') {
                throw new APIError('FORBIDDEN', {
                  message: SSO_REJECTION_MESSAGES[verdict.reason],
                });
              }
              if (verdict.ok) return { data };
            }

            await assertSignupAllowed();
            return { data };
          },
          after: async (created) => {
            // Put them in the firm, on installs that have said to.
            if (!sso.autoJoin || !ssoProvider) return;
            await attachToSoleFirm(created.id, sso.defaultRole);
          },
        },
      },
    },

    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const action = auditActionFor(ctx.path);
        if (!action) return;

        const session = ctx.context.newSession;
        const userId = session?.user.id ?? (await currentUserId(ctx.headers));
        if (!userId) return;

        const membership = await db
          .select({ firmId: firmUser.firmId })
          .from(firmUser)
          .where(eq(firmUser.userId, userId))
          .limit(1);

        await recordAuditEvent(db, {
          action,
          actorType: 'user',
          actorId: userId,
          firmId: membership[0]?.firmId ?? null,
          targetType: 'user',
          targetId: userId,
          ip: ctx.headers ? clientAddress(ctx.headers) : null,
          ua: ctx.headers?.get('user-agent') ?? null,
        });
      }),
    },

    plugins: [
      twoFactor({ issuer: 'Gather' }),
      ...(ssoProvider
        ? [
            genericOAuth({
              config: [
                {
                  providerId: ssoProvider.providerId,
                  // Endpoints come from the provider's own discovery document, so moving
                  // from Keycloak to Entra ID is a URL change and not a code change.
                  discoveryUrl: ssoProvider.discoveryUrl,
                  // Refuse to register the provider at all unless discovery supplies the
                  // issuer and the JWKS needed to verify ID tokens. Without it, an
                  // unreachable or incomplete discovery document silently downgrades the
                  // provider to decoding tokens it has not verified — which is worse than
                  // not having SSO.
                  requireIdTokenVerification: true,
                  clientId: ssoProvider.clientId,
                  clientSecret: ssoProvider.clientSecret,
                  scopes: ssoProvider.scopes,
                  pkce: true,
                },
              ],
            }),
          ]
        : []),
      // Must stay last: it writes the cookies the other plugins set.
      nextCookies(),
    ],
  });
}

/**
 * Enforces GATHER_ALLOW_SIGNUP. `first-user-only` is the self-host default: the person
 * who installs Gather claims it, and the sign-up route closes behind them.
 */
async function assertSignupAllowed(): Promise<void> {
  const mode = env().GATHER_ALLOW_SIGNUP;
  if (mode === 'open') return;
  if (mode === 'off') {
    throw new APIError('FORBIDDEN', { message: 'Sign-ups are disabled on this Gather install.' });
  }
  const [existing] = await getDb().select({ total: count() }).from(userTable);
  if ((existing?.total ?? 0) > 0) {
    throw new APIError('FORBIDDEN', {
      message:
        'This Gather install already has an account. Ask the owner to invite you, or set GATHER_ALLOW_SIGNUP=open.',
    });
  }
}

/** Whether the sign-up page should be reachable at all right now. */
export async function isSignupAllowed(): Promise<boolean> {
  const mode = env().GATHER_ALLOW_SIGNUP;
  if (mode === 'open') return true;
  if (mode === 'off') return false;
  const [existing] = await getDb().select({ total: count() }).from(userTable);
  return (existing?.total ?? 0) === 0;
}

async function currentUserId(headers: Headers | undefined): Promise<string | null> {
  if (!headers) return null;
  const session = await getAuth().api.getSession({ headers });
  return session?.user.id ?? null;
}

/**
 * Attach a brand-new SSO user to the firm, when there is exactly one.
 *
 * The common enterprise shape: one firm, staff managed in the identity provider, nobody
 * wanting to send an invitation per person. `soleFirmId` returning `null` on an install
 * with two firms is what stops this dropping somebody into the wrong client list — they
 * land on the ordinary "create or join a firm" path instead.
 *
 * Silent on failure by design: a provisioning problem must not turn into a failed sign-in
 * for somebody the provider already authenticated.
 */
async function attachToSoleFirm(userId: string, role: 'member' | 'admin'): Promise<void> {
  const db = getDb();
  const firmId = await soleFirmId(db);
  if (!firmId) return;
  await db.transaction((tx) => joinFirm(tx, { firmId, userId, role, via: 'sso-auto-join' }));
}
