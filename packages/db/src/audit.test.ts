import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appendAuditEvent, recordAuditEvent, verifyStoredAuditChain } from './audit.js';
import { createDatabase, createPool, type Database } from './client.js';
import { runMigrations } from './migrator.js';
import { auditEvent, auditHead } from './schema/audit.js';

/**
 * Integration tests against a real PostgreSQL instance — the chain's correctness depends
 * on Postgres behaviour (advisory locks, jsonb normalisation, timestamptz precision) that
 * a mock could not reproduce. CI starts a postgres service for this; locally, point
 * TEST_DATABASE_URL at a scratch database.
 */
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'Set TEST_DATABASE_URL (or DATABASE_URL) to a scratch Postgres database to run the database tests.',
  );
}

let pool: Pool;
let db: Database;

beforeAll(async () => {
  pool = createPool(connectionString, { max: 12 });
  db = createDatabase(pool);
  await runMigrations(pool, db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  // The append-only trigger blocks DELETE, which is the point of it. Clearing between
  // tests is exactly the privileged operation the trigger is meant to make deliberate.
  await db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_event`);
  await db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_head`);
});

/**
 * Drizzle wraps driver failures in DrizzleQueryError, so the message raised by Postgres
 * lives on the cause chain. Flatten it so assertions can see what actually happened.
 */
async function failureMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '(no error was thrown)';
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const message = (current as { message?: string }).message;
      if (message) parts.push(message);
      current = (current as { cause?: unknown }).cause;
    }
    return parts.join(' | ');
  }
}

describe('audit chain', () => {
  it('numbers events from 1 and verifies', async () => {
    for (const action of ['auth.sign_up', 'firm.created', 'auth.sign_in']) {
      await recordAuditEvent(db, { action, actorType: 'user', actorId: 'user_1' });
    }

    const rows = await db.select().from(auditEvent).orderBy(auditEvent.id);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(rows[0]?.prevHash).toBe('0'.repeat(64));
    expect(rows[1]?.prevHash).toBe(rows[0]?.hash);
    expect(rows[2]?.prevHash).toBe(rows[1]?.hash);

    const head = await db.select().from(auditHead);
    expect(head[0]).toMatchObject({ lastId: 3, lastHash: rows[2]?.hash });

    await expect(verifyStoredAuditChain(db)).resolves.toMatchObject({ ok: true, count: 3 });
  });

  it('survives a jsonb round trip of awkward metadata', async () => {
    await recordAuditEvent(db, {
      action: 'request.created',
      actorType: 'system',
      metadata: {
        // Keys deliberately out of order — Postgres will reorder them in jsonb.
        zebra: 'Ärger "quoted"',
        nested: { b: [3, 1, 2], a: null },
        emoji: '🧾',
        count: 42,
        flag: false,
      },
    });

    await expect(verifyStoredAuditChain(db)).resolves.toMatchObject({ ok: true, count: 1 });
  });

  it('keeps the chain contiguous under concurrent writes', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        recordAuditEvent(db, {
          action: 'concurrency.probe',
          actorType: 'system',
          metadata: { index },
        }),
      ),
    );

    const rows = await db.select({ id: auditEvent.id }).from(auditEvent).orderBy(auditEvent.id);
    expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    await expect(verifyStoredAuditChain(db)).resolves.toMatchObject({ ok: true, count: 25 });
  });

  it('commits the event and its subject together when appended in a transaction', async () => {
    await expect(
      db.transaction(async (tx) => {
        await appendAuditEvent(tx, { action: 'firm.created', actorType: 'user', actorId: 'u' });
        throw new Error('caller rolled back');
      }),
    ).rejects.toThrow('caller rolled back');

    const rows = await db.select().from(auditEvent);
    expect(rows).toHaveLength(0);
  });

  it('refuses UPDATE and DELETE at the database level', async () => {
    await recordAuditEvent(db, { action: 'auth.sign_in', actorType: 'user', actorId: 'u' });

    await expect(
      failureMessage(db.execute(sql`update audit_event set action = 'tampered' where id = 1`)),
    ).resolves.toMatch(/append-only: UPDATE is not permitted/);
    await expect(
      failureMessage(db.execute(sql`delete from audit_event where id = 1`)),
    ).resolves.toMatch(/append-only: DELETE is not permitted/);
  });

  it('detects tampering once the trigger is bypassed', async () => {
    await recordAuditEvent(db, { action: 'auth.sign_in', actorType: 'user', actorId: 'u' });
    await recordAuditEvent(db, { action: 'auth.sign_out', actorType: 'user', actorId: 'u' });

    await db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
    await db.execute(sql`update audit_event set action = 'auth.nothing_happened' where id = 1`);
    await db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);

    const result = await verifyStoredAuditChain(db);
    expect(result).toMatchObject({ ok: false, failedAt: 1 });
    expect(result.ok === false && result.reason).toMatch(/hash mismatch/);
  });

  it('detects a truncated tail via the head pointer', async () => {
    await recordAuditEvent(db, { action: 'a', actorType: 'system' });
    await recordAuditEvent(db, { action: 'b', actorType: 'system' });

    await db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
    await db.execute(sql`delete from audit_event where id = 2`);
    await db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);

    const result = await verifyStoredAuditChain(db);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/removed from the end/);
  });

  it('rejects metadata that could never be re-verified', async () => {
    await expect(
      recordAuditEvent(db, {
        action: 'bad.metadata',
        actorType: 'system',
        metadata: { at: new Date() } as never,
      }),
    ).rejects.toThrow(/ISO string/);
  });
});
