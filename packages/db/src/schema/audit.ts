import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Append-only, hash-chained audit log — plan.md §4.4, §6, and the 16 CFR 314.4(c)(8)
 * requirement to "monitor and log the activity of authorized users".
 *
 * Two deliberate schema decisions:
 *
 * 1. **No foreign keys.** An audit row has to outlive whatever it describes. `ON DELETE
 *    SET NULL` would rewrite audit rows when a request is deleted — silently breaking the
 *    chain — and `ON DELETE CASCADE` would erase the evidence. `ON DELETE RESTRICT` would
 *    make deletion impossible forever. So firm_id / request_id are plain columns.
 * 2. **`created_at` is `timestamptz(3)`.** The hash preimage serialises the timestamp as
 *    ISO-8601 with millisecond precision. Postgres's default microsecond precision would
 *    round-trip to a different string and every hash would fail to re-verify.
 *
 * UPDATE and DELETE are blocked by a database trigger (see the custom migration
 * `0001_audit_append_only.sql`), so tampering requires disabling that trigger first —
 * and the chain then catches what the trigger no longer prevents.
 */

const ts = { withTimezone: true, precision: 3 } as const;

export const auditActorType = pgEnum('audit_actor_type', ['user', 'client', 'system']);

export const auditEvent = pgTable(
  'audit_event',
  {
    /** Chain position: contiguous from 1, assigned under an advisory lock. */
    id: bigint({ mode: 'number' }).primaryKey(),
    firmId: uuid(),
    requestId: uuid(),
    actorType: auditActorType().notNull(),
    /** Better Auth user id, portal token id, or null for system actions. */
    actorId: text(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    metadata: jsonb().notNull().default({}),
    ip: text(),
    ua: text(),
    createdAt: timestamp(ts).notNull(),
    prevHash: varchar({ length: 64 }).notNull(),
    hash: varchar({ length: 64 }).notNull(),
  },
  (table) => [
    index().on(table.firmId, table.id),
    index().on(table.requestId, table.id),
    index().on(table.action),
  ],
);

/**
 * Single-row pointer to the end of the chain. Without it, deleting the newest events
 * would leave a chain that still verifies — truncation would be invisible.
 */
export const auditHead = pgTable(
  'audit_head',
  {
    id: integer().primaryKey(),
    lastId: bigint({ mode: 'number' }).notNull(),
    lastHash: varchar({ length: 64 }).notNull(),
    updatedAt: timestamp(ts).notNull().defaultNow(),
  },
  (table) => [check('audit_head_singleton', sql`${table.id} = 1`)],
);
