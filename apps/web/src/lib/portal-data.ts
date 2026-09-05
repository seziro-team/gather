import { eq } from 'drizzle-orm';
import {
  isAnswered,
  parseResponseValue,
  ResponseValueError,
  type ResponseValue,
  type TemplateItem,
} from '@gather/core';
import {
  appendAuditEvent,
  countFilesForItem,
  deleteFileRow,
  ensureResponse,
  findRequestFile,
  findRequestItem,
  getDb,
  readItemStates,
  readRequestStructure,
  recordFile,
  refreshFileResponseStatus,
  request,
  setResponseValue,
  toTemplateItem,
  type FileRow,
  type ItemState,
} from '@gather/db';
import type { StoredUpload } from '@gather/storage';
import type { PortalContext } from './portal';

/**
 * Reading and writing one request's answers, from the client's side.
 *
 * Every mutation here takes a `PortalContext` rather than an id, so the request being
 * changed is always the one the caller's session was issued for. There is no code path
 * that takes a request id from a form field.
 */

export interface PortalFileView {
  id: string;
  name: string;
  size: number;
  mime: string;
  sha256: string;
  uploadedAt: string;
  scanStatus: FileRow['scanStatus'];
}

export interface PortalItemView {
  item: TemplateItem & { id: string };
  value: ResponseValue;
  status: ItemState['status'];
  rejectNote: string | null;
  files: PortalFileView[];
  answered: boolean;
}

export interface PortalSectionView {
  id: string;
  title: string;
  description: string | null;
  items: PortalItemView[];
}

export interface PortalView {
  sections: PortalSectionView[];
  total: number;
  required: number;
  answered: number;
  requiredAnswered: number;
}

function toFileView(row: FileRow): PortalFileView {
  return {
    id: row.id,
    name: row.originalName,
    size: row.size,
    mime: row.mime,
    sha256: row.sha256,
    uploadedAt: row.uploadedAt.toISOString(),
    scanStatus: row.scanStatus,
  };
}

/**
 * The whole checklist with everything the client has put into it.
 *
 * Built from the same `readRequestStructure` the builder uses, so the portal and the firm
 * are looking at one definition of the request rather than two renderings that have to be
 * kept in step.
 */
export async function readPortalView(requestId: string): Promise<PortalView> {
  const db = getDb();
  const [body, states] = await Promise.all([
    readRequestStructure(db, requestId),
    readItemStates(db, requestId),
  ]);

  let total = 0;
  let required = 0;
  let answered = 0;
  let requiredAnswered = 0;

  const sections = body.sections.map((section, index) => ({
    id: section.id ?? `section-${index}`,
    title: section.title,
    description: section.description ?? null,
    items: section.items.map((entry) => {
      const item = entry as TemplateItem & { id: string };
      const state = states.get(item.id);
      const files = (state?.files ?? []).map(toFileView);
      const value = (state?.value ?? null) as ResponseValue;
      const done = isAnswered(item, value, files.length);

      total += 1;
      if (done) answered += 1;
      if (item.required) {
        required += 1;
        if (done) requiredAnswered += 1;
      }

      return {
        item,
        value,
        status: state?.status ?? 'pending',
        rejectNote: state?.rejectNote ?? null,
        files,
        answered: done,
      } satisfies PortalItemView;
    }),
  }));

  return { sections, total, required, answered, requiredAnswered };
}

export class PortalItemNotFound extends Error {
  constructor() {
    super('That item is not part of this request.');
    this.name = 'PortalItemNotFound';
  }
}

/** The item, typed, only if it belongs to the request this session is for. */
export async function requirePortalItem(
  portal: PortalContext,
  itemId: string,
): Promise<TemplateItem & { id: string }> {
  const row = await findRequestItem(getDb(), portal.request.id, itemId);
  if (!row) throw new PortalItemNotFound();
  return toTemplateItem(row);
}

/**
 * Store one answer.
 *
 * Autosave calls this on every pause in typing, so it is deliberately cheap and
 * idempotent. It is not audited per keystroke — an event per character would drown the
 * chain that Phase 5 exports as evidence. `portal.answers_submitted` at the end of the
 * session is the record that the client filled the request in.
 */
export async function savePortalAnswer(
  portal: PortalContext,
  itemId: string,
  raw: unknown,
): Promise<{ value: ResponseValue }> {
  const item = await requirePortalItem(portal, itemId);
  if (item.type === 'file') {
    throw new ResponseValueError('Upload a file for this item rather than typing an answer.');
  }

  const value = parseResponseValue(item, raw);
  const answered = isAnswered(item, value, 0);

  await getDb().transaction(async (tx) => {
    await setResponseValue(tx, itemId, value, answered);
    await tx
      .update(request)
      .set({ updatedAt: new Date() })
      .where(eq(request.id, portal.request.id));
  });

  return { value };
}

export interface AttachedUpload {
  id: string;
  view: PortalFileView;
}

/**
 * Record a file that has already been written to storage.
 *
 * Called after `storeUpload` succeeds, and the caller removes the object if this throws —
 * an object with no row is unreachable, which is worse than no object at all.
 */
export async function attachPortalUpload(
  portal: PortalContext,
  item: TemplateItem & { id: string },
  fileId: string,
  storageDriver: string,
  storageKey: string,
  stored: StoredUpload,
): Promise<AttachedUpload> {
  const row = await getDb().transaction(async (tx) => {
    const response = await ensureResponse(tx, item.id);
    const inserted = await recordFile(tx, {
      id: fileId,
      responseId: response.id,
      responseVersion: response.version,
      storageDriver,
      storageKey,
      originalName: stored.filename,
      mime: stored.mime,
      size: stored.size,
      sha256: stored.sha256,
      encrypted: stored.encrypted,
      dekWrapped: stored.envelope?.dekWrapped ?? null,
      iv: stored.envelope?.iv ?? null,
      tag: stored.envelope?.tag ?? null,
      uploadedIp: portal.context.ip,
    });

    await refreshFileResponseStatus(tx, response.id);
    await tx
      .update(request)
      .set({ updatedAt: new Date() })
      .where(eq(request.id, portal.request.id));

    await appendAuditEvent(tx, {
      action: 'portal.file_uploaded',
      actorType: 'client',
      firmId: portal.request.firmId,
      requestId: portal.request.id,
      targetType: 'file',
      targetId: inserted.id,
      metadata: {
        itemId: item.id,
        label: item.label,
        name: stored.filename,
        mime: stored.mime,
        size: stored.size,
        sha256: stored.sha256,
        encrypted: stored.encrypted,
        storageDriver,
      },
      ip: portal.context.ip,
      ua: portal.context.ua,
    });

    return inserted;
  });

  return { id: row.id, view: toFileView(row) };
}

export interface RemovedFile {
  storageDriver: string;
  storageKey: string;
}

/**
 * Delete a file the client uploaded.
 *
 * The row goes and the object is removed by the caller. The audit event stays: it carries
 * the name and the hash, so "there was a file here and the client took it away" survives
 * the deletion — which is the whole point of an append-only log.
 */
export async function removePortalFile(
  portal: PortalContext,
  fileId: string,
): Promise<RemovedFile | null> {
  const owned = await findRequestFile(getDb(), portal.request.id, fileId);
  if (!owned) return null;

  return getDb().transaction(async (tx) => {
    const deleted = await deleteFileRow(tx, fileId);
    if (!deleted) return null;

    await refreshFileResponseStatus(tx, deleted.responseId);
    await appendAuditEvent(tx, {
      action: 'portal.file_removed',
      actorType: 'client',
      firmId: portal.request.firmId,
      requestId: portal.request.id,
      targetType: 'file',
      targetId: fileId,
      metadata: {
        itemId: owned.item.id,
        label: owned.item.label,
        name: deleted.originalName,
        size: deleted.size,
        sha256: deleted.sha256,
      },
      ip: portal.context.ip,
      ua: portal.context.ua,
    });

    return { storageDriver: deleted.storageDriver, storageKey: deleted.storageKey };
  });
}

export async function itemFileCount(itemId: string): Promise<number> {
  return countFilesForItem(getDb(), itemId);
}

/**
 * The client says they are done.
 *
 * Deliberately not the same thing as "complete": the firm decides that, item by item, in
 * Phase 5. This marks the request as waiting on the firm rather than on the client, which
 * is the distinction the r/taxpros thread in plan.md §2.4 is entirely about.
 */
export async function submitPortal(portal: PortalContext): Promise<void> {
  const view = await readPortalView(portal.request.id);
  const outstanding = view.required - view.requiredAnswered;
  if (outstanding > 0) {
    throw new Error(
      `${outstanding} required item${outstanding === 1 ? '' : 's'} still to go. ` +
        'Fill those in and this will unlock.',
    );
  }

  await getDb().transaction(async (tx) => {
    await tx
      .update(request)
      .set({ status: 'submitted', updatedAt: new Date() })
      .where(eq(request.id, portal.request.id));

    await appendAuditEvent(tx, {
      action: 'portal.submitted',
      actorType: 'client',
      firmId: portal.request.firmId,
      requestId: portal.request.id,
      targetType: 'request',
      targetId: portal.request.id,
      metadata: { items: view.total, answered: view.answered, required: view.required },
      ip: portal.context.ip,
      ua: portal.context.ua,
    });
  });
}
