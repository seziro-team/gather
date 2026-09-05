import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordAuditEvent } from './audit.js';
import {
  auditCsv,
  parseAuditCsv,
  readAuditTrail,
  verifyAuditRows,
  type AuditRow,
} from './audit-export.js';
import { createDatabase, createPool, type Database } from './client.js';
import { runMigrations } from './migrator.js';
import { testDatabaseUrl } from './test-database.js';

/**
 * The audit export, round-tripped.
 *
 * The claim this file has to hold up is that the CSV is *evidence*: somebody with no
 * access to Gather can take the file, recompute every hash, and see for themselves that
 * nothing was altered. So the tests read the trail out, render it, parse it back, and
 * verify the parsed rows — because a verifier that only ever sees database rows proves
 * nothing about the file a firm actually hands over.
 */

let pool: Pool;
let db: Database;

beforeAll(async () => {
  pool = createPool(await testDatabaseUrl(), { max: 6 });
  db = createDatabase(pool);
  await runMigrations(pool, db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`delete from firm`);
  await db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_event`);
  await db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_head`);
});

async function seedFirm(): Promise<{ firmId: string; userId: string }> {
  const firmId = randomUUID();
  const userId = randomUUID();

  await db.execute(sql`
    insert into firm (id, name, slug, brand_color, timezone)
    values (${firmId}, 'Delgado & Co', ${`d-${firmId.slice(0, 8)}`}, '#0f766e', 'Europe/London')
  `);
  await db.execute(sql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, 'Alex Partner', ${`alex-${userId.slice(0, 8)}@example.test`}, false, now(), now())
  `);
  await db.execute(sql`
    insert into firm_user (firm_id, user_id, role) values (${firmId}, ${userId}, 'owner')
  `);

  return { firmId, userId };
}

describe('the audit export', () => {
  it('round-trips through CSV and still verifies', async () => {
    const { firmId, userId } = await seedFirm();

    // The event written before the firm exists — the one a firm-scoped filter would drop.
    await recordAuditEvent(db, { action: 'auth.sign_up', actorType: 'user', actorId: userId });
    await recordAuditEvent(db, {
      action: 'firm.created',
      actorType: 'user',
      actorId: userId,
      firmId,
    });
    await recordAuditEvent(db, {
      action: 'portal.file_uploaded',
      actorType: 'client',
      firmId,
      metadata: {
        // Awkward on purpose: a comma, a quote, a newline, a non-ASCII name and a
        // spreadsheet formula are all things a real filename has contained.
        name: 'Q1 "final", v2\nRückstellungen.pdf',
        formula: "=cmd|'/c calc'!A1",
        size: 12345,
      },
      ip: '203.0.113.7',
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)',
    });

    const rows = await readAuditTrail(db, { firmId });
    expect(rows.map((row) => row.action)).toEqual([
      'auth.sign_up',
      'firm.created',
      'portal.file_uploaded',
    ]);

    const csv = auditCsv(rows);
    const parsed = parseAuditCsv(csv);

    expect(parsed).toHaveLength(rows.length);
    expect(parsed.map((row) => row.action)).toEqual(rows.map((row) => row.action));
    expect(parsed[2]!.metadata).toEqual(rows[2]!.metadata);
    expect(parsed[2]!.createdAt.toISOString()).toBe(rows[2]!.createdAt.toISOString());

    // The point of the whole exercise: the file verifies on its own.
    const verdict = verifyAuditRows(parsed);
    expect(verdict.rowsIntact).toBe(true);
    expect(verdict.chainLinked).toBe(true);
    expect(verdict.count).toBe(3);
    expect(verdict.head).toBe(rows[2]!.hash);
  });

  it('neutralises a cell a spreadsheet would execute', async () => {
    const { firmId } = await seedFirm();
    await recordAuditEvent(db, {
      action: 'portal.file_uploaded',
      actorType: 'client',
      firmId,
      metadata: { name: '=1+1' },
    });

    const csv = auditCsv(await readAuditTrail(db, { firmId }));
    // The metadata cell is JSON, so it opens with `{` and is inert; the guard matters for
    // any column whose value could begin with a formula character.
    expect(csv).not.toMatch(/,=/);
    // And it still parses back to exactly what went in.
    expect(parseAuditCsv(csv)[0]!.metadata).toEqual({ name: '=1+1' });
  });

  it('catches a row that was altered after it was written', async () => {
    const { firmId } = await seedFirm();
    for (const action of ['request.created', 'request.link_issued', 'portal.opened']) {
      await recordAuditEvent(db, { action, actorType: 'user', firmId, actorId: null });
    }

    const rows = await readAuditTrail(db, { firmId });
    const tampered: AuditRow[] = rows.map((row, index) =>
      index === 1 ? { ...row, action: 'nothing_happened' } : row,
    );

    const verdict = verifyAuditRows(tampered);
    expect(verdict.rowsIntact).toBe(false);
    expect(verdict.failedAt).toBe(rows[1]!.id);
    expect(verdict.reason).toMatch(/content was modified/);
  });

  it('reports a filtered export as intact but not a complete chain', async () => {
    const { firmId } = await seedFirm();
    const requestId = randomUUID();
    const clientId = randomUUID();

    await db.execute(sql`
      insert into client (id, firm_id, name, email)
      values (${clientId}, ${firmId}, 'Rosa', ${`r-${clientId.slice(0, 8)}@example.test`})
    `);
    await db.execute(sql`
      insert into request (id, firm_id, client_id, title, status)
      values (${requestId}, ${firmId}, ${clientId}, 'Year-end', 'sent')
    `);

    await recordAuditEvent(db, { action: 'client.created', actorType: 'user', firmId });
    await recordAuditEvent(db, { action: 'request.created', actorType: 'user', firmId, requestId });
    await recordAuditEvent(db, { action: 'template.created', actorType: 'user', firmId });
    await recordAuditEvent(db, { action: 'portal.opened', actorType: 'client', firmId, requestId });

    const scoped = await readAuditTrail(db, { firmId, requestId });
    expect(scoped).toHaveLength(2);

    const verdict = verifyAuditRows(parseAuditCsv(auditCsv(scoped)));
    // Every row is provably unaltered…
    expect(verdict.rowsIntact).toBe(true);
    // …but it is a subset, and claiming otherwise would be claiming something the file
    // cannot support.
    expect(verdict.contiguous).toBe(false);
    expect(verdict.chainLinked).toBe(false);
  });

  it('refuses a file that is not a Gather export', () => {
    expect(() => parseAuditCsv('name,email\r\n"a","b"\r\n')).toThrow(/not a Gather audit export/);
    expect(() => parseAuditCsv('')).toThrow(/empty/);
  });

  it('filters by date without breaking row verification', async () => {
    const { firmId } = await seedFirm();
    await recordAuditEvent(db, { action: 'first.event', actorType: 'system', firmId });

    const cutoff = new Date();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await recordAuditEvent(db, { action: 'second.event', actorType: 'system', firmId });

    const recent = await readAuditTrail(db, { firmId, from: cutoff });
    expect(recent.map((row) => row.action)).toEqual(['second.event']);
    expect(verifyAuditRows(recent).rowsIntact).toBe(true);
  });
});
