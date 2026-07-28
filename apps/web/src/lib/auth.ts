import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { count, eq } from 'drizzle-orm';
import { env } from '@gather/core';
import { firmUser, getDb, recordAuditEvent, schema, user as userTable } from '@gather/db';

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

  return betterAuth({
    appName: 'Gather',
    baseURL: config.GATHER_APP_URL,
    secret: config.GATHER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg', schema }),

    emailAndPassword: {
      enabled: true,
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

    advanced: {
      useSecureCookies: isHttps,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
      },
    },

    rateLimit: {
      enabled: true,
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
            await assertSignupAllowed();
            return { data };
          },
        },
      },
    },

    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const action = AUTH_AUDIT_ACTIONS[ctx.path as keyof typeof AUTH_AUDIT_ACTIONS];
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
