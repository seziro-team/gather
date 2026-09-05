import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { auditHash, canonicalJson, GENESIS_HASH, type JsonObject } from '@gather/core';
import type { Database, DbTransaction } from './client.js';
import { auditEvent, firmUser } from './schema/index.js';

/**
 * The audit trail, as a document a firm can hand to somebody.
 *
 * plan.md §2.4 quotes a practitioner blamed for a late return who answers "I reached out
 * 6x between February and April". That is what this exports: a timestamped, hash-chained
 * record of every request, reminder and submission, in a format that opens in Excel.
 *
 * The export carries its own verification. Each row includes `prev_hash` and `hash`, so it
 * can be re-checked from the CSV alone, by anyone, without database access — which is the
 * difference between a log and evidence.
 *
 * Two properties, and the difference between them is not a detail. Every export can prove
 * **no row was altered**. Only a *complete* export can prove **no row is missing**, because
 * a trail filtered to one request has gaps in its ids by construction. `verifyAuditRows`
 * reports both separately rather than collapsing them into a reassuring "verified".
 */

export type AuditRow = typeof auditEvent.$inferSelect;

export interface AuditExportFilter {
  firmId: string;
  requestId?: string;
  from?: Date;
  to?: Date;
}

/**
 * Every event belonging to a firm.
 *
 * The `or` is not decoration. `auth.sign_up` is written before the firm exists, so it
 * carries a NULL `firm_id` and a firm-scoped filter alone would drop the first event of
 * every install — recorded as a known issue since Phase 1, and this is the fix. Union on
 * membership picks it up by actor instead.
 */
export async function readAuditTrail(
  db: Database | DbTransaction,
  filter: AuditExportFilter,
): Promise<AuditRow[]> {
  const members = db
    .select({ userId: firmUser.userId })
    .from(firmUser)
    .where(eq(firmUser.firmId, filter.firmId));

  const scope = filter.requestId
    ? and(eq(auditEvent.firmId, filter.firmId), eq(auditEvent.requestId, filter.requestId))
    : or(
        eq(auditEvent.firmId, filter.firmId),
        and(
          sql`${auditEvent.firmId} is null`,
          eq(auditEvent.actorType, 'user'),
          inArray(auditEvent.actorId, members),
        ),
      );

  const clauses = [scope];
  if (filter.from) clauses.push(gte(auditEvent.createdAt, filter.from));
  if (filter.to) clauses.push(lte(auditEvent.createdAt, filter.to));

  return db
    .select()
    .from(auditEvent)
    .where(and(...clauses))
    .orderBy(asc(auditEvent.id));
}

export const AUDIT_CSV_COLUMNS = [
  'id',
  'created_at',
  'action',
  'actor_type',
  'actor_id',
  'firm_id',
  'request_id',
  'target_type',
  'target_id',
  'metadata',
  'ip',
  'user_agent',
  'prev_hash',
  'hash',
] as const;

/**
 * RFC 4180 quoting, with one addition.
 *
 * A leading `=`, `+`, `-` or `@` makes Excel and Sheets treat a cell as a formula, so a
 * client who names a file `=cmd|'/c calc'!A1` gets it executed on the firm's machine when
 * they open the export. Prefixing a tab neutralises it and is invisible in the cell.
 */
export function csvCell(value: string | number | JsonObject | null | undefined): string {
  if (value === null || value === undefined) return '';
  // `canonicalJson` for the metadata column, so the cell round-trips byte-for-byte and the
  // hash recomputes from the exported file rather than only from the database.
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? String(value)
        : canonicalJson(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `\t${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function auditCsvRow(row: AuditRow): string {
  const cells: (string | number | JsonObject | null)[] = [
    row.id,
    row.createdAt.toISOString(),
    row.action,
    row.actorType,
    row.actorId,
    row.firmId,
    row.requestId,
    row.targetType,
    row.targetId,
    (row.metadata ?? {}) as JsonObject,
    row.ip,
    row.ua,
    row.prevHash,
    row.hash,
  ];
  return cells.map(csvCell).join(',');
}

/** The whole trail as CSV, header included. */
export function auditCsv(rows: AuditRow[]): string {
  const lines = [AUDIT_CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(auditCsvRow(row));
  // CRLF, because that is what RFC 4180 says and what Excel expects.
  return `${lines.join('\r\n')}\r\n`;
}

export interface ExportVerification {
  /**
   * Every row's hash recomputes from its own content and its recorded `prev_hash`.
   *
   * This is checkable on any export, filtered or not, and it is the property that makes
   * the file evidence: no row was altered after it was written.
   */
  rowsIntact: boolean;
  /**
   * The rows form an unbroken chain — contiguous ids, each linking to the last.
   *
   * Only true for a **complete** export. A trail filtered to one request or one month is
   * a subset by construction, so its ids have gaps and nothing is wrong with that. Saying
   * "chain intact" about a subset would be claiming something the file cannot support.
   */
  chainLinked: boolean;
  contiguous: boolean;
  /** Rows checked. On failure this is how many verified *before* the bad one, not the total. */
  count: number;
  head: string | null;
  /** The first row that failed, when one did. */
  failedAt: number | null;
  reason: string | null;
}

/**
 * Re-verify a trail read out of the database — or back out of an exported CSV.
 *
 * Uses `auditHash` from @gather/core, the same function that wrote the hashes, so a change
 * to the preimage cannot make the writer and the verifier disagree silently.
 */
export function verifyAuditRows(rows: readonly AuditRow[]): ExportVerification {
  let previous: string | null = null;
  let contiguous = true;
  let linked = true;
  let verified = 0;

  for (const [index, row] of rows.entries()) {
    const recomputed = auditHash(
      row.id,
      row.createdAt,
      {
        firmId: row.firmId,
        requestId: row.requestId,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: (row.metadata ?? {}) as JsonObject,
        ip: row.ip,
        ua: row.ua,
      },
      row.prevHash,
    );

    if (recomputed !== row.hash) {
      return {
        rowsIntact: false,
        chainLinked: false,
        contiguous: false,
        // How many verified before this one — not the file's length. "Verified 11 events
        // before failing" on a file whose 8th row is bad reads as if the tampering were
        // somewhere it is not.
        count: verified,
        head: null,
        failedAt: row.id,
        reason:
          `hash mismatch on event ${row.id} — its content was modified after it was written ` +
          `(stored ${row.hash.slice(0, 12)}…, recomputed ${recomputed.slice(0, 12)}…)`,
      };
    }

    const expectedId = index === 0 ? row.id : rows[index - 1]!.id + 1;
    if (row.id !== expectedId) contiguous = false;
    if (previous !== null && row.prevHash !== previous) linked = false;
    previous = row.hash;
    verified += 1;
  }

  const startsAtGenesis = rows[0]?.prevHash === GENESIS_HASH && rows[0]?.id === 1;

  return {
    rowsIntact: true,
    chainLinked: linked && contiguous && startsAtGenesis,
    contiguous,
    count: verified,
    head: rows.at(-1)?.hash ?? null,
    failedAt: null,
    reason: null,
  };
}

/**
 * Read an exported CSV back into rows, so the file can be verified on its own.
 *
 * This is the half that makes the export evidence rather than a printout: a firm can hand
 * the CSV to an insurer or a client, and the recipient can check it without access to
 * Gather, the database, or the firm.
 *
 * A hand-rolled parser because the format is ours and fully known — every field is quoted
 * by `csvCell`, so the grammar is "quoted strings separated by commas" and a CSV library
 * would be a dependency to parse a file we also write.
 */
export function parseAuditCsv(text: string): AuditRow[] {
  const records = parseRecords(text);
  const header = records.shift();
  if (!header) throw new Error('The file is empty.');

  const expected = AUDIT_CSV_COLUMNS.join(',');
  if (header.join(',') !== expected) {
    throw new Error(
      `That is not a Gather audit export. Expected the header\n  ${expected}\nbut found\n  ${header.join(',')}`,
    );
  }

  return records.map((cells, index) => {
    if (cells.length !== AUDIT_CSV_COLUMNS.length) {
      throw new Error(
        `Row ${index + 2} has ${cells.length} fields, expected ${AUDIT_CSV_COLUMNS.length}.`,
      );
    }
    const [
      id,
      createdAt,
      action,
      actorType,
      actorId,
      firmId,
      requestId,
      targetType,
      targetId,
      metadata,
      ip,
      ua,
      prevHash,
      hash,
    ] = cells as string[];

    return {
      id: Number(id),
      createdAt: new Date(createdAt!),
      action: action!,
      actorType: actorType as AuditRow['actorType'],
      actorId: nullable(actorId!),
      firmId: nullable(firmId!),
      requestId: nullable(requestId!),
      targetType: nullable(targetType!),
      targetId: nullable(targetId!),
      // Written by `csvCell` through `canonicalJson`, so this round-trips exactly — which
      // is what lets the hash recompute from the file.
      metadata: JSON.parse(unguard(metadata!) || '{}') as AuditRow['metadata'],
      ip: nullable(ip!),
      ua: nullable(ua!),
      prevHash: prevHash!,
      hash: hash!,
    } satisfies AuditRow;
  });
}

function nullable(value: string): string | null {
  return value === '' ? null : value;
}

/** Undo the leading tab `csvCell` adds to stop spreadsheets evaluating a cell. */
function unguard(value: string): string {
  return value.startsWith('\t') ? value.slice(1) : value;
}

/** RFC 4180: quoted fields, `""` for a literal quote, CRLF or LF between records. */
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      started = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      started = true;
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      if (started || field !== '' || row.length > 0) {
        row.push(field);
        records.push(row);
      }
      row = [];
      field = '';
      started = false;
      continue;
    }
    field += char;
    started = true;
  }

  if (started || field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  return records;
}
