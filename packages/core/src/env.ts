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

/** An unset variable and one set to the empty string mean the same thing to an operator. */
const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const envSchema = z
  .object({
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

    /** Writable state: the generated secrets, and uploads when the driver is `local`. */
    GATHER_DATA_DIR: z.string().trim().min(1).default('./data'),

    // ── Storage ──────────────────────────────────────────────────────────────
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    /** Defaults to `${GATHER_DATA_DIR}/uploads`; see `storagePaths` below. */
    STORAGE_LOCAL_PATH: optionalText,
    STORAGE_ENCRYPTION: z.enum(['on', 'off']).default('on'),
    GATHER_ENCRYPTION_KEY: optionalText,
    GATHER_MAX_UPLOAD_MB: z.coerce.number().int().positive().max(5_000).default(100),

    S3_BUCKET: optionalText,
    S3_REGION: z.string().trim().min(1).default('us-east-1'),
    S3_ENDPOINT: optionalText,
    S3_ACCESS_KEY_ID: optionalText,
    S3_SECRET_ACCESS_KEY: optionalText,
    /** Off only for real AWS with a bucket that has a DNS name. */
    S3_FORCE_PATH_STYLE: booleanish.default(true),

    // ── Client portal ────────────────────────────────────────────────────────
    /** How long a magic link stays usable. */
    GATHER_PORTAL_LINK_DAYS: z.coerce.number().int().positive().max(365).default(30),
    /** How long the session a link creates lasts, so a shared device forgets eventually. */
    GATHER_PORTAL_SESSION_HOURS: z.coerce.number().int().positive().max(720).default(72),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER !== 's3') return;

    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'is required when STORAGE_DRIVER=s3',
        });
      }
    }

    // The container can generate an encryption key into its own data volume, which is
    // coherent while the files live in that same volume. Once the objects are in a bucket
    // somewhere else, a key that only exists in a container volume is a way to lose every
    // document to a `docker compose down -v`. So: say it out loud instead.
    if (value.STORAGE_ENCRYPTION === 'on' && !value.GATHER_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GATHER_ENCRYPTION_KEY'],
        message:
          'must be set explicitly when STORAGE_DRIVER=s3 — Gather will not generate a key it ' +
          'cannot store next to the files. Generate one with `openssl rand -base64 32` and keep ' +
          'a backup: without it the objects in your bucket cannot be read.',
      });
    }
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
