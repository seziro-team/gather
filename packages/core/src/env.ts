import { z } from 'zod';
import { LOG_LEVELS } from './logger.js';

/**
 * Runtime configuration, validated once and cached.
 *
 * Deliberately lazy: `next build` runs with no database and no secrets, so parsing at
 * module load would fail the Docker build. Nothing here is read until a request or a
 * CLI actually needs it.
 */

/**
 * The value shipped in `.env.example` so that `cp .env.example .env && docker compose up`
 * works on a clean machine in one step. Booting with it in production is refused outright.
 */
export const INSECURE_DEV_AUTH_SECRET = 'dev-only-insecure-secret-change-me-before-production';

const booleanish = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const httpUrl = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'must be an absolute http(s) URL, e.g. http://localhost:3000' },
);

const postgresUrl = z.string().refine((value) => /^postgres(ql)?:\/\//.test(value), {
  message: 'must be a postgres:// connection string',
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: postgresUrl,
  GATHER_APP_URL: httpUrl,
  GATHER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  GATHER_ALLOW_SIGNUP: z.enum(['first-user-only', 'open', 'off']).default('first-user-only'),
  GATHER_REQUIRE_2FA: booleanish.default(true),
  GATHER_LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // Read directly from process.env by the startup hook, which runs before anything
  // else; declared here so it is validated and documented alongside the rest.
  GATHER_AUTO_MIGRATE: booleanish.default(true),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production' && env.GATHER_AUTH_SECRET === INSECURE_DEV_AUTH_SECRET) {
    throw new EnvError([
      'GATHER_AUTH_SECRET: refusing to start in production with the example secret. ' +
        'Generate one with `openssl rand -base64 48`.',
    ]);
  }

  return env;
}

/** Validated environment, parsed on first use and cached for the process lifetime. */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test helper: forget the cached parse so a different environment can be loaded. */
export function resetEnvCache(): void {
  cached = null;
}
