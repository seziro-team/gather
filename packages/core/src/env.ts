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

    // ── Email ────────────────────────────────────────────────────────────────
    /**
     * `none` is the honest default. Gather ships with no mail credentials, so out of the
     * box it says "no email is configured" in the UI rather than queueing reminders that
     * will never leave — which is the failure mode this default exists to prevent.
     */
    MAIL_DRIVER: z.enum(['none', 'resend', 'smtp']).default('none'),
    MAIL_FROM: optionalText,
    MAIL_REPLY_TO: optionalText,
    /**
     * The DKIM selector `pnpm check:email` looks for. Resend publishes under `resend`;
     * your own mail server chose its own when you set it up.
     */
    MAIL_DKIM_SELECTOR: z.string().trim().min(1).default('resend'),

    RESEND_API_KEY: optionalText,
    /** From the Resend dashboard's webhook page; starts `whsec_`. */
    RESEND_WEBHOOK_SECRET: optionalText,

    SMTP_HOST: optionalText,
    SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
    /** True for implicit TLS on 465. Port 587 upgrades with STARTTLS and wants this false. */
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: optionalText,
    SMTP_PASSWORD: optionalText,
    SMTP_REQUIRE_VALID_CERT: booleanish.default(true),

    // ── Antivirus ────────────────────────────────────────────────────────────
    /**
     * `none` is the default, and the honest one.
     *
     * ClamAV wants 3–4 GiB of RAM — more than the rest of Gather combined — so turning it
     * on by default would break the cheap-VPS promise in plan.md §5. With it off, files
     * are marked `skipped` and the UI says "Not scanned"; they are never silently treated
     * as clean.
     */
    ANTIVIRUS_DRIVER: z.enum(['none', 'clamav']).default('none'),
    CLAMAV_HOST: z.string().trim().min(1).default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().positive().max(65535).default(3310),
    /** A 100 MB scan is not instant, and a timeout that fires mid-scan quarantines a file. */
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(120_000),

    // ── Security ─────────────────────────────────────────────────────────────
    /**
     * Trust `X-Forwarded-For` for the client address.
     *
     * Off by default, and that is deliberate. With it on and no proxy in front, anyone can
     * set the header and choose which rate-limit bucket they land in — so this must only
     * be turned on when something you control is actually terminating the connection.
     */
    GATHER_TRUST_PROXY: booleanish.default(false),
    /** Rate limiting. Off only for a load test you are running yourself. */
    GATHER_RATE_LIMIT: booleanish.default(true),
    /**
     * Rate limiting on the authentication endpoints specifically.
     *
     * Separate from `GATHER_RATE_LIMIT` because the numbers are much tighter — three
     * sign-ups per five minutes, five sign-in attempts a minute — and because those
     * numbers are correct for an install on the internet and wrong for a test stack where
     * every test creates an account.
     *
     * ⚠️ Never turn this off on an install anyone else can reach. It is the only thing
     * standing between a password and an unlimited number of guesses.
     */
    GATHER_AUTH_RATE_LIMIT: booleanish.default(true),
    /**
     * How long a completed request's files are kept before `pnpm retention:purge` will
     * remove them. `0` means never purge, which is the default: deleting a firm's client
     * documents on a timer they did not set is not a decision Gather gets to make.
     */
    GATHER_RETENTION_DAYS: z.coerce.number().int().min(0).max(36_500).default(0),

    // ── Gather Cloud ─────────────────────────────────────────────────────────
    /**
     * Turns on the hosted tier: billing pages, plan limits, the admin panel.
     *
     * Off on every self-hosted install, and off is not a lesser mode — a firm with no
     * subscription row is on `self_hosted`, which has no limits at all. See
     * packages/core/src/plans.ts for why that is `null` rather than a large number.
     */
    GATHER_CLOUD: booleanish.default(false),
    /** Test-mode keys (`sk_test_…`) until the operator flips them. */
    STRIPE_SECRET_KEY: optionalText,
    STRIPE_WEBHOOK_SECRET: optionalText,
    STRIPE_PRICE_CLOUD: optionalText,
    STRIPE_PRICE_CLOUD_PRO: optionalText,
    /**
     * Addresses allowed into the Seziro admin panel, comma-separated.
     *
     * Empty means nobody, which is what a self-hosted install wants: the panel is for
     * whoever runs the hosted tier, and an install that is not the hosted tier should not
     * have one at all.
     */
    GATHER_ADMIN_EMAILS: optionalText,

    // ── Worker ───────────────────────────────────────────────────────────────
    /**
     * How often the worker looks for schedules that have come due, in minutes.
     *
     * Minutes rather than seconds because the scan is a pg-boss cron entry, and cron's
     * resolution is a minute. A variable that promised seconds and silently rounded would
     * be worse than one that says what it does.
     */
    GATHER_REMINDER_SCAN_MINUTES: z.coerce.number().int().min(1).max(60).default(1),
    /** Ceiling on reminders sent per scan, so a backlog cannot become a sending burst. */
    GATHER_REMINDER_BATCH: z.coerce.number().int().min(1).max(500).default(50),
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
  })
  .superRefine((value, ctx) => {
    if (value.MAIL_DRIVER === 'none') return;

    // A driver with no From address would fail on the first send, at 9am, silently, in a
    // background worker. Failing at boot instead is the whole point of validating config.
    if (!value.MAIL_FROM) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_FROM'],
        message:
          'is required when MAIL_DRIVER is set. Use an address on a domain you control, ' +
          'e.g. "Delgado Bookkeeping <documents@delgado.example>".',
      });
    }

    if (value.MAIL_DRIVER === 'resend' && !value.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'is required when MAIL_DRIVER=resend. Create one at https://resend.com/api-keys.',
      });
    }

    if (value.MAIL_DRIVER === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'is required when MAIL_DRIVER=smtp.',
      });
    }
  })
  .superRefine((value, ctx) => {
    if (!value.GATHER_CLOUD) return;

    // A hosted tier with billing half-configured is worse than one with none: the plan
    // pages appear, the buttons are there, and the first person to press one gets an error
    // on a payment screen. Refuse to boot instead.
    const required = {
      STRIPE_SECRET_KEY: 'https://dashboard.stripe.com/test/apikeys',
      STRIPE_WEBHOOK_SECRET: 'https://dashboard.stripe.com/test/webhooks',
      STRIPE_PRICE_CLOUD: 'the price id of the Gather Cloud product',
      STRIPE_PRICE_CLOUD_PRO: 'the price id of the Gather Cloud Pro product',
    } as const;

    for (const [key, where] of Object.entries(required)) {
      if (!value[key as keyof typeof required]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `is required when GATHER_CLOUD=true — get it from ${where}.`,
        });
      }
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
