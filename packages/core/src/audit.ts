import { createHash } from 'node:crypto';
import { canonicalJson, type JsonObject } from './canonical-json.js';

/**
 * Tamper-evident audit chain.
 *
 * Every audit event stores the hash of the event before it, so any modification or
 * removal of a row invalidates every hash after it. The chain gives a firm exportable
 * evidence that a request was sent, chased and completed on the dates it claims — the
 * "I reached out 6x between February and April" problem from plan.md §2.4.
 *
 * Honest limits, also stated in SECURITY.md: this is tamper *evidence*, not tamper
 * prevention. Someone with full write access to the database can recompute the whole
 * chain. Detecting that requires anchoring the head hash somewhere outside the database,
 * which is what exporting an audit trail (Phase 5) is for.
 */

/** Bumped only if the preimage layout changes; old rows keep verifying under their own version. */
export const AUDIT_HASH_VERSION = 1;

/** `prevHash` of the very first event in the chain. */
export const GENESIS_HASH = '0'.repeat(64);

export type AuditActorType = 'user' | 'client' | 'system';

/** The mutable content of an audit event — everything except its position in the chain. */
export interface AuditEventBody {
  firmId: string | null;
  requestId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: JsonObject;
  ip: string | null;
  ua: string | null;
}

/** A persisted audit event, as read back from the database. */
export interface AuditChainLink extends AuditEventBody {
  id: number;
  createdAt: Date;
  prevHash: string;
  hash: string;
}

/**
 * The exact bytes that get hashed. Timestamps are serialised as ISO-8601 with
 * millisecond precision, which is why `audit_event.created_at` is declared
 * `timestamptz(3)`: at any higher precision Postgres would return a value that no
 * longer round-trips through `Date`, and the chain would fail to re-verify.
 */
export function auditPreimage(
  id: number,
  createdAt: Date,
  body: AuditEventBody,
  prevHash: string,
): string {
  return canonicalJson({
    v: AUDIT_HASH_VERSION,
    id,
    prevHash,
    createdAt: createdAt.toISOString(),
    firmId: body.firmId,
    requestId: body.requestId,
    actorType: body.actorType,
    actorId: body.actorId,
    action: body.action,
    targetType: body.targetType,
    targetId: body.targetId,
    metadata: body.metadata,
    ip: body.ip,
    ua: body.ua,
  });
}

export function auditHash(
  id: number,
  createdAt: Date,
  body: AuditEventBody,
  prevHash: string,
): string {
  return createHash('sha256')
    .update(auditPreimage(id, createdAt, body, prevHash), 'utf8')
    .digest('hex');
}

export interface AuditHead {
  lastId: number;
  lastHash: string;
}

export type AuditChainVerification =
  | { ok: true; count: number; headHash: string }
  | { ok: false; count: number; failedAt: number | null; reason: string };

/**
 * Verify a complete chain, in ascending id order.
 *
 * `head` is the separately stored pointer to the last event. Checking it is what makes
 * truncation detectable: deleting the newest rows leaves an intact-looking chain, but
 * the head no longer matches.
 */
export function verifyAuditChain(
  rows: readonly AuditChainLink[],
  head?: AuditHead | null,
): AuditChainVerification {
  let prevHash = GENESIS_HASH;
  let expectedId = 1;

  for (const row of rows) {
    if (row.id !== expectedId) {
      return {
        ok: false,
        count: rows.length,
        failedAt: row.id,
        reason: `expected event id ${expectedId} but found ${row.id} — an event was deleted or inserted out of order`,
      };
    }
    if (row.prevHash !== prevHash) {
      return {
        ok: false,
        count: rows.length,
        failedAt: row.id,
        reason: `prev_hash does not match the previous event's hash (expected ${prevHash.slice(0, 12)}…, stored ${row.prevHash.slice(0, 12)}…)`,
      };
    }
    const recomputed = auditHash(row.id, row.createdAt, row, row.prevHash);
    if (recomputed !== row.hash) {
      return {
        ok: false,
        count: rows.length,
        failedAt: row.id,
        reason: `hash mismatch — event content was modified (stored ${row.hash.slice(0, 12)}…, recomputed ${recomputed.slice(0, 12)}…)`,
      };
    }
    prevHash = row.hash;
    expectedId += 1;
  }

  if (head) {
    if (head.lastId !== rows.length) {
      return {
        ok: false,
        count: rows.length,
        failedAt: rows.length,
        reason: `head points at event ${head.lastId} but the chain holds ${rows.length} events — events were removed from the end`,
      };
    }
    if (head.lastHash !== prevHash) {
      return {
        ok: false,
        count: rows.length,
        failedAt: rows.length,
        reason: `head hash ${head.lastHash.slice(0, 12)}… does not match the last event ${prevHash.slice(0, 12)}…`,
      };
    }
  } else if (rows.length > 0) {
    return {
      ok: false,
      count: rows.length,
      failedAt: rows.length,
      reason: 'chain head is missing — the audit_head row was deleted',
    };
  }

  return { ok: true, count: rows.length, headHash: prevHash };
}
