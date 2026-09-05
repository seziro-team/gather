import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.js';

/** The Gather domain model — plan.md §4.4. */

const ts = { withTimezone: true, precision: 3 } as const;

export const firmRole = pgEnum('firm_role', ['owner', 'admin', 'member']);

/** draft → sent → in_progress → submitted → complete. `archived` is terminal and reversible. */
export const requestStatus = pgEnum('request_status', [
  'draft',
  'sent',
  'in_progress',
  'submitted',
  'complete',
  'archived',
]);

export const itemType = pgEnum('item_type', [
  'file',
  'text',
  'longtext',
  'yesno',
  'date',
  'choice',
  'number',
]);

/** Per-item review state. A request is only `complete` when every required item is `approved`. */
export const responseStatus = pgEnum('response_status', [
  'pending',
  'submitted',
  'approved',
  'rejected',
]);

/** `skipped` is used — and surfaced in the UI — when the antivirus profile is switched off. */
export const scanStatus = pgEnum('scan_status', ['pending', 'clean', 'infected', 'skipped']);

export const tokenPurpose = pgEnum('token_purpose', ['portal']);

export const reminderChannel = pgEnum('reminder_channel', ['email']);

export const firm = pgTable('firm', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logoUrl: text(),
  brandColor: text().notNull().default('#0f766e'),
  timezone: text().notNull().default('UTC'),
  createdAt: timestamp(ts).notNull().defaultNow(),
  updatedAt: timestamp(ts).notNull().defaultNow(),
});

export const firmUser = pgTable(
  'firm_user',
  {
    id: uuid().primaryKey().defaultRandom(),
    firmId: uuid()
      .notNull()
      .references(() => firm.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: firmRole().notNull().default('member'),
    createdAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [unique('firm_user_unique').on(table.firmId, table.userId), index().on(table.userId)],
);

export const client = pgTable(
  'client',
  {
    id: uuid().primaryKey().defaultRandom(),
    firmId: uuid()
      .notNull()
      .references(() => firm.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    email: text().notNull(),
    phone: text(),
    company: text(),
    archivedAt: timestamp(ts),
    createdAt: timestamp(ts).notNull().defaultNow(),
    updatedAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [index().on(table.firmId)],
);

export const template = pgTable(
  'template',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** NULL for the templates that ship with Gather; set for a firm's own saved templates. */
    firmId: uuid().references(() => firm.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    body: jsonb().notNull(),
    isBuiltin: boolean().notNull().default(false),
    createdAt: timestamp(ts).notNull().defaultNow(),
    updatedAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [
    // Built-in keys are globally unique; a firm's own keys are unique within that firm.
    uniqueIndex('template_builtin_key')
      .on(table.key)
      .where(sql`${table.firmId} is null`),
    uniqueIndex('template_firm_key')
      .on(table.firmId, table.key)
      .where(sql`${table.firmId} is not null`),
  ],
);

export const request = pgTable(
  'request',
  {
    id: uuid().primaryKey().defaultRandom(),
    firmId: uuid()
      .notNull()
      .references(() => firm.id, { onDelete: 'cascade' }),
    clientId: uuid()
      .notNull()
      .references(() => client.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    description: text(),
    status: requestStatus().notNull().default('draft'),
    dueAt: timestamp(ts),
    sentAt: timestamp(ts),
    completedAt: timestamp(ts),
    templateKey: text(),
    /** Branding frozen at send time, so a later logo change doesn't rewrite history. */
    brandSnapshot: jsonb(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp(ts).notNull().defaultNow(),
    updatedAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [index().on(table.firmId, table.status), index().on(table.clientId)],
);

export const section = pgTable(
  'section',
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid()
      .notNull()
      .references(() => request.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    position: integer().notNull().default(0),
  },
  (table) => [index().on(table.requestId, table.position)],
);

export const item = pgTable(
  'item',
  {
    id: uuid().primaryKey().defaultRandom(),
    sectionId: uuid()
      .notNull()
      .references(() => section.id, { onDelete: 'cascade' }),
    type: itemType().notNull(),
    label: text().notNull(),
    helpText: text(),
    required: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    /** Type-specific settings: accepted extensions, choice options, min/max, and so on. */
    config: jsonb().notNull().default({}),
  },
  (table) => [index().on(table.sectionId, table.position)],
);

export const response = pgTable(
  'response',
  {
    id: uuid().primaryKey().defaultRandom(),
    itemId: uuid()
      .notNull()
      .unique()
      .references(() => item.id, { onDelete: 'cascade' }),
    value: jsonb(),
    status: responseStatus().notNull().default('pending'),
    rejectNote: text(),
    submittedAt: timestamp(ts),
    reviewedAt: timestamp(ts),
    reviewedBy: text().references(() => user.id, { onDelete: 'set null' }),
    /** Bumped on every rejection so a resubmission is distinguishable from the original. */
    version: integer().notNull().default(1),
    createdAt: timestamp(ts).notNull().defaultNow(),
    updatedAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [index().on(table.status)],
);

export const file = pgTable(
  'file',
  {
    id: uuid().primaryKey().defaultRandom(),
    responseId: uuid()
      .notNull()
      .references(() => response.id, { onDelete: 'cascade' }),
    /** Which response version this upload belongs to; superseded files are kept, not deleted. */
    responseVersion: integer().notNull().default(1),
    /**
     * Which driver holds the bytes, recorded per file rather than read from the environment
     * at download time. A firm that moves from local disk to S3 must still be able to open
     * everything it collected before the switch.
     */
    storageDriver: text().notNull().default('local'),
    storageKey: text().notNull().unique(),
    originalName: text().notNull(),
    mime: text().notNull(),
    size: bigint({ mode: 'number' }).notNull(),
    /** SHA-256 of the plaintext, so an encrypted download can be proven byte-identical. */
    sha256: varchar({ length: 64 }).notNull(),
    scanStatus: scanStatus().notNull().default('pending'),
    encrypted: boolean().notNull().default(true),
    /** Envelope encryption: per-file data key, wrapped by the master key from the environment. */
    dekWrapped: text(),
    iv: text(),
    tag: text(),
    uploadedAt: timestamp(ts).notNull().defaultNow(),
    uploadedIp: text(),
  },
  (table) => [index().on(table.responseId), index().on(table.scanStatus)],
);

export const accessToken = pgTable(
  'access_token',
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid()
      .notNull()
      .references(() => request.id, { onDelete: 'cascade' }),
    /** Only the SHA-256 of the magic-link token is stored; the token itself is never persisted. */
    tokenHash: varchar({ length: 64 }).notNull().unique(),
    purpose: tokenPurpose().notNull().default('portal'),
    expiresAt: timestamp(ts).notNull(),
    revokedAt: timestamp(ts),
    lastUsedAt: timestamp(ts),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [index().on(table.requestId)],
);

export const portalSession = pgTable(
  'portal_session',
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid()
      .notNull()
      .references(() => request.id, { onDelete: 'cascade' }),
    tokenId: uuid()
      .notNull()
      .references(() => accessToken.id, { onDelete: 'cascade' }),
    sessionHash: varchar({ length: 64 }).notNull().unique(),
    ip: text(),
    ua: text(),
    expiresAt: timestamp(ts).notNull(),
    lastSeenAt: timestamp(ts).notNull().defaultNow(),
    createdAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [index().on(table.requestId)],
);

export const reminderSchedule = pgTable(
  'reminder_schedule',
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid()
      .notNull()
      .references(() => request.id, { onDelete: 'cascade' }),
    /** Cadence definition: interval or escalating steps, send time, quiet hours, timezone. */
    cadence: jsonb().notNull(),
    active: boolean().notNull().default(true),
    nextRunAt: timestamp(ts),
    sentCount: integer().notNull().default(0),
    maxCount: integer(),
    createdAt: timestamp(ts).notNull().defaultNow(),
    updatedAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [index().on(table.active, table.nextRunAt)],
);

export const reminderLog = pgTable(
  'reminder_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid()
      .notNull()
      .references(() => request.id, { onDelete: 'cascade' }),
    scheduleId: uuid().references(() => reminderSchedule.id, { onDelete: 'set null' }),
    channel: reminderChannel().notNull().default('email'),
    toAddress: text().notNull(),
    providerMessageId: text(),
    status: text().notNull(),
    error: text(),
    /**
     * What makes a reminder send exactly once.
     *
     * Derived, not random: `<schedule id>:<sent count>` for a scheduled reminder. The row
     * is inserted *before* the message is handed to a driver, so a worker that is killed
     * mid-send and restarted computes the same key, collides with this unique index, and
     * declines to send a second copy.
     *
     * Resend's `Idempotency-Key` header carries the same value, which collapses a
     * duplicate at their end too — but SMTP has no equivalent, and a guarantee that only
     * holds for one of two drivers is not a guarantee. This index is the real one.
     */
    idempotencyKey: text().notNull(),
    sentAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.requestId),
    index().on(table.providerMessageId),
    uniqueIndex().on(table.idempotencyKey),
  ],
);
