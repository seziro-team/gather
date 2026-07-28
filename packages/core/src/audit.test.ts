import { describe, expect, it } from 'vitest';
import {
  auditHash,
  GENESIS_HASH,
  verifyAuditChain,
  type AuditChainLink,
  type AuditEventBody,
} from './audit.js';

const BASE: AuditEventBody = {
  firmId: '00000000-0000-4000-8000-000000000001',
  requestId: null,
  actorType: 'user',
  actorId: 'user_1',
  action: 'auth.sign_in',
  targetType: 'user',
  targetId: 'user_1',
  metadata: {},
  ip: '203.0.113.4',
  ua: 'Mozilla/5.0',
};

/** Build a valid chain of `length` events, one second apart. */
function buildChain(length: number): AuditChainLink[] {
  const rows: AuditChainLink[] = [];
  let prevHash = GENESIS_HASH;
  for (let id = 1; id <= length; id += 1) {
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, id));
    const body: AuditEventBody = { ...BASE, metadata: { step: id } };
    const hash = auditHash(id, createdAt, body, prevHash);
    rows.push({ ...body, id, createdAt, prevHash, hash });
    prevHash = hash;
  }
  return rows;
}

function headOf(rows: AuditChainLink[]) {
  const last = rows.at(-1);
  return last ? { lastId: last.id, lastHash: last.hash } : null;
}

describe('auditHash', () => {
  it('is deterministic for identical input', () => {
    const at = new Date('2026-07-28T09:00:00.000Z');
    expect(auditHash(1, at, BASE, GENESIS_HASH)).toBe(auditHash(1, at, BASE, GENESIS_HASH));
  });

  it('changes when any field changes', () => {
    const at = new Date('2026-07-28T09:00:00.000Z');
    const original = auditHash(1, at, BASE, GENESIS_HASH);
    expect(auditHash(1, at, { ...BASE, action: 'auth.sign_out' }, GENESIS_HASH)).not.toBe(original);
    expect(auditHash(2, at, BASE, GENESIS_HASH)).not.toBe(original);
    expect(auditHash(1, new Date(at.getTime() + 1), BASE, GENESIS_HASH)).not.toBe(original);
    expect(auditHash(1, at, BASE, 'f'.repeat(64))).not.toBe(original);
  });

  it('ignores metadata key order, so a jsonb read-back still verifies', () => {
    const at = new Date('2026-07-28T09:00:00.000Z');
    const a = auditHash(1, at, { ...BASE, metadata: { b: 2, a: 1 } }, GENESIS_HASH);
    const b = auditHash(1, at, { ...BASE, metadata: { a: 1, b: 2 } }, GENESIS_HASH);
    expect(a).toBe(b);
  });
});

describe('verifyAuditChain', () => {
  it('accepts an empty chain with no head', () => {
    expect(verifyAuditChain([], null)).toEqual({ ok: true, count: 0, headHash: GENESIS_HASH });
  });

  it('accepts an intact chain', () => {
    const rows = buildChain(5);
    const result = verifyAuditChain(rows, headOf(rows));
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ count: 5, headHash: rows[4]?.hash });
  });

  it('detects a modified event', () => {
    const rows = buildChain(5);
    rows[2] = { ...rows[2]!, action: 'auth.sign_out' };
    const result = verifyAuditChain(rows, headOf(rows));
    expect(result).toMatchObject({ ok: false, failedAt: 3 });
    expect(result.ok === false && result.reason).toMatch(/hash mismatch/);
  });

  it('detects a deleted event in the middle', () => {
    const rows = buildChain(5);
    rows.splice(2, 1);
    const result = verifyAuditChain(rows, { lastId: 5, lastHash: rows.at(-1)!.hash });
    expect(result).toMatchObject({ ok: false, failedAt: 4 });
    expect(result.ok === false && result.reason).toMatch(/deleted or inserted out of order/);
  });

  it('detects a truncated tail, which the chain alone cannot see', () => {
    const rows = buildChain(5);
    const head = headOf(rows);
    const truncated = rows.slice(0, 3);
    // The remaining rows still link to each other perfectly...
    expect(verifyAuditChain(truncated, headOf(truncated)).ok).toBe(true);
    // ...which is exactly why the head pointer is stored separately.
    expect(verifyAuditChain(truncated, head)).toMatchObject({ ok: false });
  });

  it('detects a rewritten prev_hash', () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1]!, prevHash: 'a'.repeat(64) };
    expect(verifyAuditChain(rows, headOf(rows))).toMatchObject({ ok: false, failedAt: 2 });
  });

  it('rejects a chain whose head row is missing', () => {
    const rows = buildChain(2);
    expect(verifyAuditChain(rows, null)).toMatchObject({ ok: false });
  });
});
