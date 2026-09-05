import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit.js';
import type { Database } from './client.js';
import { file, item, request, response, section } from './schema/gather.js';

/**
 * Secure disposal — 16 CFR 314.4(c)(6).
 *
 * The Safeguards Rule asks a firm to dispose of customer information it no longer needs.
 * Gather cannot decide what a firm no longer needs, so this does exactly one thing: for
 * requests the firm has marked **complete**, older than a stated number of days, delete
 * the stored bytes.
 *
 * What survives, deliberately:
 *
 *  - **The `file` row**, with its name, size and SHA-256. "There was a document here, it
 *    hashed to this, and it was disposed of on this date" is the record a firm needs to
 *    show it *had* something — deleting the row would erase the evidence along with the
 *    document.
 *  - **The audit trail**, which is append-only and cannot be deleted at all.
 *  - **Anything not complete.** A request still being chased is information the firm needs.
 *
 * Purging is never automatic. `GATHER_RETENTION_DAYS` defaults to `0`, meaning never, and
 * the CLI requires `--confirm`. Deleting a firm's client documents on a timer they did not
 * set is not a decision Gather gets to make.
 */

export interface PurgeCandidate {
  fileId: string;
  requestId: string;
  firmId: string;
  storageDriver: string;
  storageKey: string;
  originalName: string;
  sha256: string;
  size: number;
  /** Never null in practice — the query requires it — but the column is nullable. */
  completedAt: Date | null;
}

/** Files belonging to requests completed before `before`, whose bytes are still present. */
export async function purgeCandidates(
  db: Database,
  before: Date,
  limit = 1000,
): Promise<PurgeCandidate[]> {
  return db
    .select({
      fileId: file.id,
      requestId: request.id,
      firmId: request.firmId,
      storageDriver: file.storageDriver,
      storageKey: file.storageKey,
      originalName: file.originalName,
      sha256: file.sha256,
      size: file.size,
      // The column itself, not `sql<Date>\`…\``. A raw fragment is typed by the caller and
      // parsed by nobody, so drizzle hands back the driver's string and every Date method
      // on it throws — which is how a purge deleted eight files from disk and then failed
      // to record any of them.
      completedAt: request.completedAt,
    })
    .from(file)
    .innerJoin(response, eq(response.id, file.responseId))
    .innerJoin(item, eq(item.id, response.itemId))
    .innerJoin(section, eq(section.id, item.sectionId))
    .innerJoin(request, eq(request.id, section.requestId))
    .where(
      and(
        eq(request.status, 'complete'),
        isNotNull(request.completedAt),
        lt(request.completedAt, before),
        // Already purged files keep their row; `purged_at` is what stops them coming back
        // round on the next run.
        sql`${file.purgedAt} is null`,
      ),
    )
    .limit(limit);
}

/**
 * Record that a file's bytes are gone.
 *
 * Called **after** the storage driver has removed the object, and the ordering is a real
 * decision rather than an accident. Neither direction is transactional across a filesystem
 * and a database, so one of two things can go wrong:
 *
 *  - Mark first, delete second: a failed delete leaves a row claiming disposal that did not
 *    happen. That is a compliance claim, and a false one.
 *  - Delete first, mark second: a failed mark leaves a row pointing at a missing object.
 *    Visible, fixable, and re-running the purge completes it — both storage drivers treat
 *    removing something that is already gone as a success.
 *
 * The second is the recoverable failure, so it is the one Gather takes.
 */
export async function markPurged(db: Database, candidate: PurgeCandidate): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(file)
      .set({ purgedAt: new Date(), storageKey: `purged:${candidate.fileId}` })
      .where(eq(file.id, candidate.fileId));

    await appendAuditEvent(tx, {
      action: 'file.purged',
      actorType: 'system',
      firmId: candidate.firmId,
      requestId: candidate.requestId,
      targetType: 'file',
      targetId: candidate.fileId,
      metadata: {
        name: candidate.originalName,
        sha256: candidate.sha256,
        size: candidate.size,
        completedAt: candidate.completedAt?.toISOString() ?? null,
      },
    });
  });
}
