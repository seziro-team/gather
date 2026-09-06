import { asc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  assertJsonObject,
  auditHash,
  GENESIS_HASH,
  verifyAuditChain,
  type AuditActorType,
  type AuditChainLink,
  type AuditChainVerification,
  type AuditEventBody,
  type JsonObject,
} from '@gather/core';
import type { Database, DbTransaction } from './client.js';
import { auditEvent, auditHead } from './schema/audit.js';

/**
 * Serialises every append so that chain position, prev_hash and the head pointer are
 * consistent under concurrency. A transaction-scoped advisory lock is released
 * automatically on commit or rollback, so a crashed request cannot wedge the chain.
 *
 * The literal is written inline rather than bound as a parameter: an untyped parameter
 * makes `pg_advisory_xact_lock` ambiguous between its (bigint) and (int, int) overloads.
 */
const AUDIT_LOCK_SQL = sql`select pg_advisory_xact_lock(8410570001)`;

export interface RecordAuditInput {
  action: string;
  actorType: AuditActorType;
  actorId?: string | null;
  firmId?: string | null;
  requestId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: JsonObject;
  ip?: string | null;
  ua?: string | null;
}

export type AuditEventRow = typeof auditEvent.$inferSelect;

function toBody(input: RecordAuditInput): AuditEventBody {
  return {
    firmId: input.firmId ?? null,
    requestId: input.requestId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: assertJsonObject(input.metadata ?? {}, 'audit metadata'),
    ip: input.ip ?? null,
    ua: input.ua ?? null,
  };
}

/**
 * Append one event inside an existing transaction. Use this when the event must commit
 * atomically with the change it describes.
 */
export async function appendAuditEvent(
  tx: DbTransaction,
  input: RecordAuditInput,
): Promise<AuditEventRow> {
  await tx.execute(AUDIT_LOCK_SQL);

  const head = await tx.select().from(auditHead).where(eq(auditHead.id, 1)).limit(1);
  const previous = head[0];
  const id = (previous?.lastId ?? 0) + 1;
  const prevHash = previous?.lastHash ?? GENESIS_HASH;

  // Millisecond precision on purpose — see the note in schema/audit.ts.
  const createdAt = new Date();
  const body = toBody(input);
  const hash = auditHash(id, createdAt, body, prevHash);

  const inserted = await tx
    .insert(auditEvent)
    .values({ id, ...body, createdAt, prevHash, hash })
    .returning();

  await tx
    .insert(auditHead)
    .values({ id: 1, lastId: id, lastHash: hash, updatedAt: createdAt })
    .onConflictDoUpdate({
      target: auditHead.id,
      set: { lastId: id, lastHash: hash, updatedAt: createdAt },
    });

  const row = inserted[0];
  if (!row) throw new Error('audit event insert returned no row');
  return row;
}

/** Append one event in its own transaction. */
export async function recordAuditEvent(
  db: Database,
  input: RecordAuditInput,
): Promise<AuditEventRow> {
  return db.transaction((tx) => appendAuditEvent(tx, input));
}

/**
 * Read the whole chain and verify it. Streams in pages so that verifying a long-lived
 * firm's log does not require loading every event into memory at once.
 */
export async function verifyStoredAuditChain(
  db: Database,
  pageSize = 1000,
): Promise<AuditChainVerification> {
  const head = await db.select().from(auditHead).where(eq(auditHead.id, 1)).limit(1);
  const rows: AuditChainLink[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const page = await db
      .select()
      .from(auditEvent)
      .orderBy(asc(auditEvent.id))
      .limit(pageSize)
      .offset(offset);
    for (const row of page) {
      rows.push({
        id: row.id,
        firmId: row.firmId,
        requestId: row.requestId,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata as JsonObject,
        ip: row.ip,
        ua: row.ua,
        createdAt: row.createdAt,
        prevHash: row.prevHash,
        hash: row.hash,
      });
    }
    if (page.length < pageSize) break;
  }

  const current = head[0];
  return verifyAuditChain(
    rows,
    current ? { lastId: current.lastId, lastHash: current.lastHash } : null,
  );
}

/** The current head of the chain: the newest event's id and hash. */
export async function readAuditHead(
  db: Database,
): Promise<{ lastId: number; lastHash: string; updatedAt: Date } | null> {
  const rows = await db.select().from(auditHead).where(eq(auditHead.id, 1)).limit(1);
  const row = rows[0];
  return row ? { lastId: row.lastId, lastHash: row.lastHash, updatedAt: row.updatedAt } : null;
}

/** The stored hash of one event, for checking an anchor against the chain it came from. */
export async function readAuditHash(db: Database, id: number): Promise<string | null> {
  const rows = await db
    .select({ hash: auditEvent.hash })
    .from(auditEvent)
    .where(eq(auditEvent.id, id))
    .limit(1);
  return rows[0]?.hash ?? null;
}
