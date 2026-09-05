import { Readable } from 'node:stream';
import { env, signDownload, verifyDownload, expiryIn, DOWNLOAD_LINK_SECONDS } from '@gather/core';
import type { FileRow } from '@gather/db';
import {
  getStorage,
  LocalStorage,
  localStoragePath,
  masterKeyFrom,
  openStored,
  S3Storage,
  type StorageDriver,
} from '@gather/storage';

/**
 * Serving a stored file back out.
 *
 * Two routes reach this — one for the client's portal, one for the firm — and they differ
 * only in whose session they check. Everything about *how* a file is returned lives here
 * so the two cannot drift apart on a security header.
 */

/**
 * The driver that holds a particular file, which is not necessarily the configured one.
 *
 * A firm that starts on local disk and moves to S3 keeps everything it already collected;
 * the `file.storage_driver` column says where each object actually is.
 */
export function storageForDriver(name: string): StorageDriver {
  const configured = getStorage();
  if (configured.name === name) return configured;

  const config = env();
  if (name === 'local') return new LocalStorage(localStoragePath(config));

  if (name === 's3' && config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY) {
    return new S3Storage({
      bucket: config.S3_BUCKET,
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
  }

  throw new Error(
    `This file was stored with the "${name}" driver, which is not configured. Set the ` +
      `S3_* variables (or STORAGE_DRIVER=${name}) to reach it again.`,
  );
}

export async function openFile(row: FileRow): Promise<Readable> {
  return openStored({
    driver: storageForDriver(row.storageDriver),
    key: row.storageKey,
    encrypted: row.encrypted,
    envelope:
      row.dekWrapped && row.iv && row.tag
        ? { dekWrapped: row.dekWrapped, iv: row.iv, tag: row.tag }
        : null,
    masterKey: row.encrypted ? masterKeyFrom() : null,
  });
}

export async function removeStoredObject(driverName: string, key: string): Promise<void> {
  await storageForDriver(driverName).remove(key);
}

/** RFC 6266 / RFC 5987: an ASCII fallback plus the real name for anything that can read it. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * A download response.
 *
 * `attachment` always, even for a photo the client just uploaded. A tax document rendered
 * inline is a tax document inside Gather's origin, and plan.md §6 puts uploads on a
 * separate origin in Phase 6 precisely because that is not a line worth walking. The
 * sniffed type is sent because it is ours — never the browser's claim — and `nosniff`
 * plus a `default-src 'none'` policy means nothing about it is negotiable.
 */
export function fileResponse(stream: Readable, row: FileRow): Response {
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(row.size),
      'Content-Disposition': contentDisposition(row.originalName),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export interface SignedDownload {
  expiresAt: number;
  signature: string;
}

export function signFileDownload(fileId: string, scope: string): SignedDownload {
  const expiresAt = expiryIn(DOWNLOAD_LINK_SECONDS);
  return {
    expiresAt,
    signature: signDownload(env().GATHER_AUTH_SECRET, { fileId, scope, expiresAt }),
  };
}

export function downloadQuery(signed: SignedDownload): string {
  return `exp=${signed.expiresAt}&sig=${signed.signature}`;
}

export function checkFileDownload(fileId: string, scope: string, params: URLSearchParams): boolean {
  const expiresAt = Number(params.get('exp'));
  const signature = params.get('sig') ?? '';
  return verifyDownload(env().GATHER_AUTH_SECRET, { fileId, scope, expiresAt }, signature).ok;
}

export function portalScope(requestId: string): string {
  return `portal:${requestId}`;
}

export function firmScope(firmId: string): string {
  return `firm:${firmId}`;
}
