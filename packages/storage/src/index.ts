import { join } from 'node:path';
import { env, type Env } from '@gather/core';
import { parseMasterKey } from './crypto.js';
import type { StorageDriver } from './driver.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';

export {
  createDecryptor,
  createEncryptor,
  generateMasterKey,
  parseMasterKey,
  EncryptionKeyError,
  MASTER_KEY_BYTES,
  type Encryptor,
  type Envelope,
} from './crypto.js';

export {
  assertValidKey,
  storageKeyFor,
  ObjectMissing,
  STORAGE_DRIVERS,
  type StorageDriver,
  type StorageDriverName,
} from './driver.js';

export { LocalStorage } from './local.js';
export { S3Storage, type S3Options } from './s3.js';

export {
  extensionOf,
  sanitizeFilename,
  sniffUpload,
  SNIFF_BYTES,
  UploadRejected,
  type SniffInput,
  type SniffResult,
} from './sniff.js';

export {
  openStored,
  storeUpload,
  UploadEmpty,
  UploadTooLarge,
  type OpenStoredInput,
  type StoreUploadInput,
  type StoredUpload,
} from './pipeline.js';

/** Where the local driver keeps objects. `STORAGE_LOCAL_PATH` overrides it outright. */
export function localStoragePath(config: Env = env()): string {
  return config.STORAGE_LOCAL_PATH ?? join(config.GATHER_DATA_DIR, 'uploads');
}

/**
 * The master key, or `null` when the operator has turned encryption off.
 *
 * Parsed on every call rather than cached: it is a few microseconds, and a cached copy of
 * a key is one more place a key lives.
 */
export function masterKeyFrom(config: Env = env()): Buffer | null {
  if (config.STORAGE_ENCRYPTION === 'off') return null;
  if (!config.GATHER_ENCRYPTION_KEY) {
    throw new Error(
      'GATHER_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`, or set ' +
        'STORAGE_ENCRYPTION=off if you deliberately want files stored in the clear.',
    );
  }
  return parseMasterKey(config.GATHER_ENCRYPTION_KEY);
}

export function createStorage(config: Env = env()): StorageDriver {
  if (config.STORAGE_DRIVER === 's3') {
    return new S3Storage({
      // The env schema refuses `STORAGE_DRIVER=s3` without these, so they are present.
      bucket: config.S3_BUCKET!,
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.S3_ACCESS_KEY_ID!,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalStorage(localStoragePath(config));
}

interface StorageSingleton {
  driver: StorageDriver;
}

// Next replaces the module registry on every hot reload; without a global handle each
// reload would build a new S3 client and leak its sockets.
const globalRef = globalThis as typeof globalThis & { __gatherStorage?: StorageSingleton };

export function getStorage(): StorageDriver {
  globalRef.__gatherStorage ??= { driver: createStorage() };
  return globalRef.__gatherStorage.driver;
}
