import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createDecryptor, createEncryptor, type Envelope } from './crypto.js';
import type { StorageDriver } from './driver.js';
import { sanitizeFilename, sniffUpload, SNIFF_BYTES } from './sniff.js';

/**
 * One pass over an upload: measure it, hash it, work out what it is, encrypt it, store it.
 *
 * Nothing here buffers a whole file. The client's bytes arrive in chunks, and each chunk is
 * hashed, encrypted and handed to the driver before the next one is read — so a 200 MB
 * upload costs the same memory as a 200 KB one, and a phone on a slow connection is not
 * holding a copy of its own tax return in Gather's heap.
 */

export class UploadTooLarge extends Error {
  constructor(readonly limitBytes: number) {
    super(`That file is larger than the ${Math.floor(limitBytes / 1024 / 1024)} MB limit.`);
    this.name = 'UploadTooLarge';
  }
}

export class UploadEmpty extends Error {
  constructor() {
    super('That file is empty.');
    this.name = 'UploadEmpty';
  }
}

export interface StoreUploadInput {
  driver: StorageDriver;
  key: string;
  /** Plaintext, straight off the request. */
  body: Readable;
  /** Whatever the browser called it; sanitized here, never trusted. */
  filename: string;
  /** The item's accepted extensions. Empty or absent means anything not blocked outright. */
  accept?: readonly string[];
  maxBytes: number;
  /** `null` when STORAGE_ENCRYPTION=off — the documented bandwidth trade-off. */
  masterKey: Buffer | null;
}

export interface StoredUpload {
  filename: string;
  /** Sniffed from the bytes. Never the browser's Content-Type. */
  mime: string;
  /** Plaintext bytes — the number a person recognises as the size of their document. */
  size: number;
  /** Hex SHA-256 of the plaintext, which is what makes a download provably byte-identical. */
  sha256: string;
  encrypted: boolean;
  envelope: Envelope | null;
}

export async function storeUpload(input: StoreUploadInput): Promise<StoredUpload> {
  const filename = sanitizeFilename(input.filename);

  // The first chunks are read before anything is written, so a file that will be rejected
  // never reaches the disk and never occupies a key.
  const source = input.body.iterator({ destroyOnReturn: false });
  const head: Buffer[] = [];
  let headBytes = 0;
  while (headBytes < SNIFF_BYTES) {
    const next = await source.next();
    if (next.done) break;
    const chunk = toBuffer(next.value);
    head.push(chunk);
    headBytes += chunk.length;
  }
  const headBuffer = Buffer.concat(head);
  if (headBuffer.length === 0) throw new UploadEmpty();
  if (headBuffer.length > input.maxBytes) throw new UploadTooLarge(input.maxBytes);

  const sniffed = await sniffUpload({
    head: headBuffer.subarray(0, SNIFF_BYTES),
    filename,
    accept: input.accept,
  });

  const encryptor = input.masterKey ? createEncryptor(input.masterKey, input.key) : null;
  const hash = createHash('sha256');
  let size = 0;

  async function* process(): AsyncGenerator<Buffer> {
    for (const chunk of head) {
      yield* consume(chunk);
    }
    for await (const chunk of source) {
      yield* consume(toBuffer(chunk));
    }
    if (encryptor) {
      // GCM is a stream mode, so this is almost always empty — but "almost" is not a
      // reason to drop bytes.
      const last = encryptor.cipher.final();
      if (last.length > 0) yield last;
    }
  }

  function* consume(chunk: Buffer): Generator<Buffer> {
    size += chunk.length;
    if (size > input.maxBytes) throw new UploadTooLarge(input.maxBytes);
    hash.update(chunk);
    const out = encryptor ? encryptor.cipher.update(chunk) : chunk;
    if (out.length > 0) yield out;
  }

  try {
    await input.driver.put(input.key, Readable.from(process()));
  } catch (error) {
    // A driver that failed halfway may still have left something behind; S3 aborts its
    // own multipart, and the local driver stages outside the key, but neither promises it.
    await input.driver.remove(input.key).catch(() => undefined);
    throw error;
  }

  return {
    filename,
    mime: sniffed.mime,
    size,
    sha256: hash.digest('hex'),
    encrypted: encryptor !== null,
    envelope: encryptor ? encryptor.envelope() : null,
  };
}

export interface OpenStoredInput {
  driver: StorageDriver;
  key: string;
  encrypted: boolean;
  envelope: Envelope | null;
  masterKey: Buffer | null;
}

/**
 * The stored object as plaintext.
 *
 * If the ciphertext has been altered or truncated, GCM's tag check fails on the final
 * block and the stream errors — after some plaintext has already been emitted. That is the
 * right trade for a download (the alternative is buffering entire files in memory to verify
 * first), and it means a caller must treat a mid-stream error as "discard what you have",
 * which is exactly what a browser does with a truncated response.
 */
export async function openStored(input: OpenStoredInput): Promise<Readable> {
  const stored = await input.driver.open(input.key);
  if (!input.encrypted) return stored;

  if (!input.envelope || !input.masterKey) {
    stored.destroy();
    throw new Error(
      'This file is encrypted but no encryption key is configured. Set GATHER_ENCRYPTION_KEY ' +
        'to the key it was stored with.',
    );
  }

  const decipher = createDecryptor(input.masterKey, input.key, input.envelope);
  async function* decrypt(): AsyncGenerator<Buffer> {
    for await (const chunk of stored) {
      const out = decipher.update(toBuffer(chunk));
      if (out.length > 0) yield out;
    }
    const last = decipher.final();
    if (last.length > 0) yield last;
  }
  return Readable.from(decrypt());
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value));
}
