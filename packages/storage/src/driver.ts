import type { Readable } from 'node:stream';

/**
 * The one thing a storage backend has to do: hold opaque bytes under a key.
 *
 * Deliberately tiny. Everything interesting — encryption, hashing, sniffing, size caps —
 * happens above this line, so both drivers behave identically and a third one (a firm's
 * existing NAS, say) is a few dozen lines rather than a rewrite.
 */

export const STORAGE_DRIVERS = ['local', 's3'] as const;
export type StorageDriverName = (typeof STORAGE_DRIVERS)[number];

export interface StorageDriver {
  readonly name: StorageDriverName;
  /** Where the bytes are, for logs and the health endpoint. Never includes a secret. */
  readonly location: string;
  put(key: string, body: Readable): Promise<void>;
  /** Rejects with `ObjectMissing` if the key is not there. */
  open(key: string): Promise<Readable>;
  /** Succeeds whether or not the object existed — deletion is idempotent. */
  remove(key: string): Promise<void>;
  stat(key: string): Promise<{ size: number } | null>;
}

export class ObjectMissing extends Error {
  constructor(readonly key: string) {
    super(`No stored object for key ${key}`);
    this.name = 'ObjectMissing';
  }
}

/**
 * Keys are built by Gather, never by a client — but they end up in a filesystem path, so
 * they are validated rather than trusted. `<request-uuid>/<file-uuid>.bin`.
 */
const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/;

export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Refusing to use an unexpected storage key: ${JSON.stringify(key)}`);
  }
}

export function storageKeyFor(requestId: string, fileId: string): string {
  const key = `${requestId}/${fileId}.bin`;
  assertValidKey(key);
  return key;
}
