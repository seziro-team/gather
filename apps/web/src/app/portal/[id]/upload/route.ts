import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { NextRequest } from 'next/server';
import { env } from '@gather/core';
import {
  getStorage,
  masterKeyFrom,
  storageKeyFor,
  storeUpload,
  UploadEmpty,
  UploadRejected,
  UploadTooLarge,
} from '@gather/storage';
import { checkUploadFits } from '@/lib/cloud';
import { currentPortal } from '@/lib/portal';
import { limit, tooManyRequests } from '@/lib/throttle';
import {
  attachPortalUpload,
  itemFileCount,
  PortalItemNotFound,
  requirePortalItem,
  scanUpload,
} from '@/lib/portal-data';

/**
 * A client uploading a document.
 *
 * The body is the file itself rather than a multipart form, for two reasons: it streams
 * straight into the encryption pipeline with nothing to parse, and `XMLHttpRequest` can
 * report real progress on it — which is what a person on a phone with one bar needs to see.
 * The filename travels in a header because a header is not a file.
 *
 * A route handler rather than a server action: server actions cap request bodies at 1 MB
 * by default, and a scanned year of bank statements is not 1 MB.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A generous ceiling for anything the item does not set itself. */
const DEFAULT_MAX_FILES = 20;

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<'/portal/[id]/upload'>,
): Promise<Response> {
  const { id } = await context.params;

  const portal = await currentPortal(id);
  if (!portal) {
    return fail(401, 'Your link has expired. Open the most recent email from your accountant.');
  }
  if (portal.request.status === 'complete' || portal.request.status === 'archived') {
    return fail(409, 'This request is closed, so it cannot take any more files.');
  }

  // Per session rather than per IP: an office behind one NAT is one address and many
  // clients, and limiting them as one person breaks the product for the people least able
  // to work around it.
  const limited = await limit('portal.upload', portal.sessionId);
  if (!limited.ok) return tooManyRequests(limited, 'portal.upload');

  const itemId = request.nextUrl.searchParams.get('item') ?? '';
  let item;
  try {
    item = await requirePortalItem(portal, itemId);
  } catch (error) {
    if (error instanceof PortalItemNotFound) return fail(404, error.message);
    throw error;
  }
  if (item.type !== 'file') return fail(400, 'That item does not take a file.');

  const maxFiles = item.config.maxFiles ?? DEFAULT_MAX_FILES;
  if ((await itemFileCount(item.id)) >= maxFiles) {
    return fail(409, `You can attach up to ${maxFiles} file${maxFiles === 1 ? '' : 's'} here.`);
  }

  const config = env();
  const maxBytes = config.GATHER_MAX_UPLOAD_MB * 1024 * 1024;

  // Advisory, and checked again while streaming — a declared length is a claim.
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return fail(413, `That file is larger than the ${config.GATHER_MAX_UPLOAD_MB} MB limit.`);
  }

  // The firm's plan, on the hosted tier only. Returns without a query on a self-hosted
  // install, where there is no limit to be against.
  const room = await checkUploadFits(portal.firm.id, Number.isFinite(declared) ? declared : 0);
  if (!room.allowed) return fail(507, room.reason);

  const rawName = request.headers.get('x-gather-filename');
  if (!rawName) return fail(400, 'That upload arrived without a filename.');
  let filename: string;
  try {
    filename = decodeURIComponent(rawName);
  } catch {
    return fail(400, 'That upload arrived with an unreadable filename.');
  }

  if (!request.body) return fail(400, 'That upload arrived with no content.');

  const fileId = randomUUID();
  const driver = getStorage();
  const key = storageKeyFor(portal.request.id, fileId);

  let stored;
  try {
    stored = await storeUpload({
      driver,
      key,
      body: Readable.fromWeb(request.body as unknown as NodeReadableStream),
      filename,
      accept: item.config.accept,
      maxBytes,
      masterKey: masterKeyFrom(),
    });
  } catch (error) {
    if (error instanceof UploadTooLarge) return fail(413, error.message);
    if (error instanceof UploadRejected) return fail(415, error.message);
    if (error instanceof UploadEmpty) return fail(400, error.message);
    throw error;
  }

  let attached;
  try {
    attached = await attachPortalUpload(portal, item, fileId, driver.name, key, stored);
  } catch (error) {
    // An object with no row is unreachable and would never be cleaned up. Better to lose
    // the upload and tell the client to try again than to leak bytes into the bucket.
    await driver.remove(key).catch(() => undefined);
    throw error;
  }

  // Scanned inline, after the bytes are stored and while the row says `pending` — so the
  // file is undownloadable throughout, and the client is told what happened rather than
  // finding out later that their document vanished.
  const scan = await scanUpload(portal, fileId, driver.name, key, stored);
  if (scan === 'infected') {
    return fail(
      422,
      'That file contains malware, so it has not been kept. If this is unexpected, ' +
        'check the device you sent it from.',
    );
  }

  return Response.json({ file: { ...attached.view, scanStatus: scan } }, { status: 201 });
}
