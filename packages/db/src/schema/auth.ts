import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Better Auth tables.
 *
 * Reconciled against `npx auth@1.6.25 generate` — column names, nullability and defaults
 * match what the library expects, and the export names (`user`, `session`, `account`,
 * `verification`, `twoFactor`) are the model names its Drizzle adapter looks up, so they
 * must not be renamed.
 *
 * One deliberate divergence: timestamps are `timestamptz(3)` rather than the generator's
 * bare `timestamp`. A naive timestamp column round-trips through the server's local
 * timezone, which would make session expiry depend on the container's TZ setting.
 *
 * `two_factor` comes from the twoFactor() plugin and is what makes TOTP possible —
 * 16 CFR 314.4(c)(5) requires MFA for anyone accessing customer information.
 */

const ts = { withTimezone: true, precision: 3 } as const;

export const user = pgTable('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp(ts).notNull().defaultNow(),
  updatedAt: timestamp(ts)
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  twoFactorEnabled: boolean().notNull().default(false),
});

export const session = pgTable(
  'session',
  {
    id: text().primaryKey(),
    expiresAt: timestamp(ts).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp(ts).notNull().defaultNow(),
    updatedAt: timestamp(ts)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp(ts),
    refreshTokenExpiresAt: timestamp(ts),
    scope: text(),
    /** Argon2id hash written by Better Auth. Never a plaintext credential. */
    password: text(),
    createdAt: timestamp(ts).notNull().defaultNow(),
    updatedAt: timestamp(ts)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp(ts).notNull(),
    createdAt: timestamp(ts).notNull().defaultNow(),
    updatedAt: timestamp(ts)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const twoFactor = pgTable(
  'two_factor',
  {
    id: text().primaryKey(),
    /** TOTP shared secret, encrypted by Better Auth with GATHER_AUTH_SECRET. */
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Nullable with a `true` default, matching the generator: the plugin sets this
    // explicitly during enrolment and relies on the default when verification is skipped.
    verified: boolean().default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: timestamp(ts),
  },
  (table) => [
    index('two_factor_secret_idx').on(table.secret),
    index('two_factor_user_id_idx').on(table.userId),
  ],
);

/**
 * Better Auth's own rate-limit store.
 *
 * Exists so `rateLimit.storage: 'database'` has somewhere to write. Until Phase 6 the
 * limiter used in-memory storage, which meant limits reset on every restart and were not
 * shared between replicas — so five sign-in attempts became five *per container per
 * deploy*, which is not a limit.
 *
 * `lastRequest` is epoch milliseconds as a `bigint`, because that is what Better Auth
 * writes; it reads it back through `Number()`.
 */
export const rateLimit = pgTable(
  'rate_limit',
  {
    id: text().primaryKey(),
    key: text().notNull(),
    count: integer().notNull(),
    lastRequest: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('rate_limit_key_idx').on(table.key)],
);
