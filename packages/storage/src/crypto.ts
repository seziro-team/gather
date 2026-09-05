import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

/**
 * Envelope encryption for uploaded files — plan.md §4.2.
 *
 * Every file gets its own 256-bit data key (a DEK). The DEK encrypts the bytes; the master
 * key from the environment encrypts the DEK. Two consequences that matter:
 *
 *  - The master key never touches file-sized inputs, so rotating it later means unwrapping
 *    and rewrapping a few hundred bytes per file rather than rewriting every object.
 *  - A leaked DEK exposes exactly one document.
 *
 * AES-256-GCM throughout. It authenticates as well as encrypts, so a byte flipped in the
 * object store is a decryption failure rather than silently corrupted output — which is the
 * property you want when the object store is somebody else's S3 bucket.
 *
 * This is why uploads stream *through* Gather instead of going browser-direct with a
 * presigned PUT: we cannot encrypt bytes we never see. `STORAGE_ENCRYPTION=off` is the
 * documented escape hatch for anyone who would rather have the bandwidth.
 */

/** AES-256. Anything else is a configuration error, not a supported variant. */
export const MASTER_KEY_BYTES = 32;
const DEK_BYTES = 32;
/** 96 bits — the IV length GCM is specified around, and the only one that avoids rehashing. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyError';
  }
}

/**
 * Accepts base64 or hex, because operators paste whatever their generator produced.
 * The length after decoding is what actually decides.
 */
export function parseMasterKey(value: string, variable = 'GATHER_ENCRYPTION_KEY'): Buffer {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new EncryptionKeyError(
      `${variable} is empty. Generate one with \`openssl rand -base64 32\`.`,
    );
  }

  const candidates = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? [Buffer.from(trimmed, 'hex')]
    : [Buffer.from(trimmed, 'base64'), Buffer.from(trimmed, 'base64url')];

  const key = candidates.find((buffer) => buffer.length === MASTER_KEY_BYTES);
  if (!key) {
    throw new EncryptionKeyError(
      `${variable} must decode to exactly ${MASTER_KEY_BYTES} bytes (256 bits). ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }
  return key;
}

export function generateMasterKey(): string {
  return randomBytes(MASTER_KEY_BYTES).toString('base64');
}

/** What the `file` row stores so the bytes can be read back. */
export interface Envelope {
  /** base64 of wrapIv ‖ wrapTag ‖ wrapped DEK. One column, because it is one secret. */
  dekWrapped: string;
  /** base64 IV the file's own cipher used. */
  iv: string;
  /** base64 GCM tag over the whole ciphertext. Only known once the last byte is written. */
  tag: string;
}

/**
 * The wrapped DEK is bound to the object it belongs to.
 *
 * Without this, a `file` row's key material could be pointed at a different object and
 * still unwrap cleanly. With it, moving `dek_wrapped` between rows fails authentication.
 */
function wrapAad(storageKey: string): Buffer {
  return Buffer.from(`gather:dek:v1:${storageKey}`, 'utf8');
}

function wrapDek(masterKey: Buffer, dek: Buffer, storageKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv) as CipherGCM;
  cipher.setAAD(wrapAad(storageKey));
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), wrapped]).toString('base64');
}

function unwrapDek(masterKey: Buffer, dekWrapped: string, storageKey: string): Buffer {
  const raw = Buffer.from(dekWrapped, 'base64');
  if (raw.length !== IV_BYTES + TAG_BYTES + DEK_BYTES) {
    throw new EncryptionKeyError('Stored key material is the wrong length for this file.');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const wrapped = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv) as DecipherGCM;
  decipher.setAAD(wrapAad(storageKey));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  } catch {
    // Deliberately not the underlying error: "unsupported state or unable to authenticate
    // data" tells an operator nothing, and tells an attacker slightly too much.
    throw new EncryptionKeyError(
      'This file could not be decrypted with the configured GATHER_ENCRYPTION_KEY. ' +
        'It was encrypted with a different key.',
    );
  }
}

export interface Encryptor {
  /** A Transform: write plaintext, read ciphertext. */
  readonly cipher: CipherGCM;
  /** Valid only once the cipher has flushed — i.e. after the pipeline finishes. */
  envelope(): Envelope;
}

export function createEncryptor(masterKey: Buffer, storageKey: string): Encryptor {
  const dek = randomBytes(DEK_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, iv) as CipherGCM;
  const dekWrapped = wrapDek(masterKey, dek, storageKey);

  return {
    cipher,
    envelope: () => ({
      dekWrapped,
      iv: iv.toString('base64'),
      // Throws if called early, which is the correct outcome: an envelope without a
      // real tag would produce a file that can never be decrypted.
      tag: cipher.getAuthTag().toString('base64'),
    }),
  };
}

/**
 * A Transform that turns ciphertext back into plaintext.
 *
 * The tag is set up front rather than at the end because we stored it — GCM verifies it on
 * `final()`, so a truncated or altered object still fails, and it fails before the last
 * chunk is handed to the caller only in the sense that `final()` errors the stream. Callers
 * must therefore treat a mid-stream error as "do not trust what you already read".
 */
export function createDecryptor(
  masterKey: Buffer,
  storageKey: string,
  envelope: Envelope,
): DecipherGCM {
  const dek = unwrapDek(masterKey, envelope.dekWrapped, storageKey);
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new EncryptionKeyError('Stored IV or authentication tag is the wrong length.');
  }
  const decipher = createDecipheriv('aes-256-gcm', dek, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  return decipher;
}
