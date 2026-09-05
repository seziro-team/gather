import { and, asc, eq, sql } from 'drizzle-orm';
import { templateItemSchema, type TemplateItem } from '@gather/core';
import type { Database, DbTransaction } from './client.js';
import { file, item, response, section } from './schema/gather.js';

/**
 * What a client has actually put into a request.
 *
 * Everything here reaches an item through its section's `request_id`, in the query rather
 * than in a check afterwards. plan.md §6 calls cross-request access "the #1 risk in this
 * app": a portal session for request A asking for request B's file has to come back empty,
 * and the way to guarantee that is to make it impossible to write the query any other way.
 */

export type ResponseRow = typeof response.$inferSelect;
export type FileRow = typeof file.$inferSelect;
export type ItemRow = typeof item.$inferSelect;

export interface ItemState {
  itemId: string;
  value: unknown;
  status: ResponseRow['status'];
  rejectNote: string | null;
  version: number;
  submittedAt: Date | null;
  files: FileRow[];
}

/** Every answer and upload in one request, keyed by item id. */
export async function readItemStates(
  db: Database | DbTransaction,
  requestId: string,
): Promise<Map<string, ItemState>> {
  const rows = await db
    .select({ item: item.id, response, file })
    .from(item)
    .innerJoin(section, eq(section.id, item.sectionId))
    .innerJoin(response, eq(response.itemId, item.id))
    .leftJoin(file, eq(file.responseId, response.id))
    .where(eq(section.requestId, requestId))
    .orderBy(asc(file.uploadedAt), asc(file.id));

  const states = new Map<string, ItemState>();
  for (const row of rows) {
    let state = states.get(row.item);
    if (!state) {
      state = {
        itemId: row.item,
        value: row.response.value,
        status: row.response.status,
        rejectNote: row.response.rejectNote,
        version: row.response.version,
        submittedAt: row.response.submittedAt,
        files: [],
      };
      states.set(row.item, state);
    }
    if (row.file) state.files.push(row.file);
  }
  return states;
}

/** The item, only if it belongs to this request. */
export async function findRequestItem(
  db: Database | DbTransaction,
  requestId: string,
  itemId: string,
): Promise<ItemRow | null> {
  const rows = await db
    .select({ item })
    .from(item)
    .innerJoin(section, eq(section.id, item.sectionId))
    .where(and(eq(item.id, itemId), eq(section.requestId, requestId)))
    .limit(1);
  return rows[0]?.item ?? null;
}

export interface RequestFile {
  file: FileRow;
  item: ItemRow;
}

/**
 * The file, only if it belongs to this request.
 *
 * Four joins deep — file → response → item → section → request — because that is the real
 * ownership path. Anything shorter would be trusting one of the intermediate ids.
 */
export async function findRequestFile(
  db: Database | DbTransaction,
  requestId: string,
  fileId: string,
): Promise<RequestFile | null> {
  const rows = await db
    .select({ file, item })
    .from(file)
    .innerJoin(response, eq(response.id, file.responseId))
    .innerJoin(item, eq(item.id, response.itemId))
    .innerJoin(section, eq(section.id, item.sectionId))
    .where(and(eq(file.id, fileId), eq(section.requestId, requestId)))
    .limit(1);
  const row = rows[0];
  return row ? { file: row.file, item: row.item } : null;
}

/**
 * The response row for an item, created if this is the first time anyone touched it.
 *
 * Rows are made on demand rather than when the request is built: a 25-item organizer that
 * a client answers three of should not carry 22 rows saying nothing happened.
 */
export async function ensureResponse(tx: DbTransaction, itemId: string): Promise<ResponseRow> {
  const inserted = await tx
    .insert(response)
    .values({ itemId, status: 'pending' })
    .onConflictDoUpdate({
      target: response.itemId,
      // A no-op update, present only so the insert always returns the row.
      set: { itemId },
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('response upsert returned no row');
  return row;
}

/**
 * Store an answer.
 *
 * An answered item becomes `submitted` and a cleared one goes back to `pending`, so the
 * firm's review queue in Phase 5 reflects what is actually waiting. A previously rejected
 * item that gets a new answer also returns to `submitted` — that is the resubmission path.
 */
export async function setResponseValue(
  tx: DbTransaction,
  itemId: string,
  value: unknown,
  answered: boolean,
): Promise<ResponseRow> {
  await ensureResponse(tx, itemId);
  const now = new Date();
  const updated = await tx
    .update(response)
    .set({
      value: value as never,
      status: answered ? 'submitted' : 'pending',
      submittedAt: answered ? now : null,
      updatedAt: now,
    })
    .where(eq(response.itemId, itemId))
    .returning();
  const row = updated[0];
  if (!row) throw new Error('response update returned no row');
  return row;
}

/**
 * An `item` row as the typed union the rest of Gather speaks.
 *
 * Parsed rather than cast: `config` is `jsonb`, so "it must be a choice config because the
 * type column says choice" is an assumption, and this is the layer that checks it. An item
 * whose config no longer satisfies its own schema fails here rather than reaching a
 * client's browser as a broken control.
 */
export function toTemplateItem(row: ItemRow): TemplateItem & { id: string } {
  const parsed = templateItemSchema.parse({
    id: row.id,
    type: row.type,
    label: row.label,
    ...(row.helpText === null ? {} : { helpText: row.helpText }),
    required: row.required,
    config: row.config,
  });
  return parsed as TemplateItem & { id: string };
}

export interface RecordFileInput {
  /** Chosen by the caller so the storage key can be built before the row exists. */
  id: string;
  responseId: string;
  responseVersion: number;
  storageDriver: string;
  storageKey: string;
  originalName: string;
  mime: string;
  size: number;
  sha256: string;
  encrypted: boolean;
  dekWrapped: string | null;
  iv: string | null;
  tag: string | null;
  uploadedIp: string | null;
}

export async function recordFile(tx: DbTransaction, input: RecordFileInput): Promise<FileRow> {
  const inserted = await tx
    .insert(file)
    .values({
      ...input,
      // Phase 6 adds the ClamAV profile. Until then this is honest rather than optimistic:
      // nothing scanned the bytes, and the UI says so instead of implying a clean result.
      scanStatus: 'skipped',
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('file insert returned no row');
  return row;
}

export async function deleteFileRow(tx: DbTransaction, fileId: string): Promise<FileRow | null> {
  const deleted = await tx.delete(file).where(eq(file.id, fileId)).returning();
  return deleted[0] ?? null;
}

export async function countFilesForItem(
  db: Database | DbTransaction,
  itemId: string,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(file)
    .innerJoin(response, eq(response.id, file.responseId))
    .where(eq(response.itemId, itemId));
  return rows[0]?.total ?? 0;
}

/** Recompute a response's status from what is attached, after an upload or a removal. */
export async function refreshFileResponseStatus(
  tx: DbTransaction,
  responseId: string,
): Promise<void> {
  const rows = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(file)
    .where(eq(file.responseId, responseId));
  const total = rows[0]?.total ?? 0;
  const now = new Date();
  await tx
    .update(response)
    .set({
      status: total > 0 ? 'submitted' : 'pending',
      submittedAt: total > 0 ? now : null,
      updatedAt: now,
    })
    .where(eq(response.id, responseId));
}
