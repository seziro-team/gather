import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer, text } from 'node:stream/consumers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateMasterKey, parseMasterKey } from './crypto.js';
import { ObjectMissing, storageKeyFor } from './driver.js';
import { LocalStorage } from './local.js';
import { openStored, storeUpload, UploadEmpty, UploadTooLarge } from './pipeline.js';
import { UploadRejected } from './sniff.js';

/** A real PDF header, so `file-type` has something genuine to recognise. */
function pdfOf(bytes: number): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(Math.max(0, bytes - 9))]);
}

const MASTER = parseMasterKey(generateMasterKey());
let root: string;
let driver: LocalStorage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'gather-storage-'));
  driver = new LocalStorage(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function freshKey(): string {
  return storageKeyFor(randomUUID(), randomUUID());
}

async function store(plaintext: Buffer, options: Partial<Parameters<typeof storeUpload>[0]> = {}) {
  const key = options.key ?? freshKey();
  const stored = await storeUpload({
    driver,
    key,
    body: Readable.from([plaintext]),
    filename: 'statement.pdf',
    maxBytes: 10 * 1024 * 1024,
    masterKey: MASTER,
    ...options,
  });
  return { key, stored };
}

describe('storeUpload', () => {
  it('stores ciphertext and gives back the plaintext hash and size', async () => {
    const plaintext = pdfOf(64_000);
    const { key, stored } = await store(plaintext);

    expect(stored.size).toBe(plaintext.length);
    expect(stored.sha256).toBe(createHash('sha256').update(plaintext).digest('hex'));
    expect(stored.mime).toBe('application/pdf');
    expect(stored.encrypted).toBe(true);
    expect(stored.envelope).not.toBeNull();

    // Acceptance ③, at the unit level: what lands on disk is not the document.
    const onDisk = await readFile(join(root, key));
    expect(onDisk).toHaveLength(plaintext.length);
    expect(onDisk.equals(plaintext)).toBe(false);
    expect(onDisk.subarray(0, 5).toString('latin1')).not.toBe('%PDF-');
  });

  it('returns a byte-identical file when it is read back', async () => {
    const plaintext = pdfOf(250_000);
    const { key, stored } = await store(plaintext);

    const readBack = await buffer(
      await openStored({
        driver,
        key,
        encrypted: stored.encrypted,
        envelope: stored.envelope,
        masterKey: MASTER,
      }),
    );
    expect(readBack.equals(plaintext)).toBe(true);
    expect(createHash('sha256').update(readBack).digest('hex')).toBe(stored.sha256);
  });

  it('streams rather than buffering — many chunks arrive as one document', async () => {
    const chunks = Array.from({ length: 200 }, (_, index) =>
      index === 0 ? pdfOf(1024) : randomBytes(1024),
    );
    const plaintext = Buffer.concat(chunks);
    const key = freshKey();
    const stored = await storeUpload({
      driver,
      key,
      body: Readable.from(chunks),
      filename: 'many-chunks.pdf',
      maxBytes: 10 * 1024 * 1024,
      masterKey: MASTER,
    });

    expect(stored.size).toBe(plaintext.length);
    const readBack = await buffer(
      await openStored({
        driver,
        key,
        encrypted: true,
        envelope: stored.envelope,
        masterKey: MASTER,
      }),
    );
    expect(readBack.equals(plaintext)).toBe(true);
  });

  it('stores plaintext when encryption is switched off, and says so', async () => {
    const plaintext = pdfOf(2048);
    const { key, stored } = await store(plaintext, { masterKey: null });

    expect(stored.encrypted).toBe(false);
    expect(stored.envelope).toBeNull();
    expect((await readFile(join(root, key))).equals(plaintext)).toBe(true);

    const readBack = await buffer(
      await openStored({ driver, key, encrypted: false, envelope: null, masterKey: null }),
    );
    expect(readBack.equals(plaintext)).toBe(true);
  });

  it('refuses a file over the limit without storing any of it', async () => {
    const key = freshKey();
    await expect(
      storeUpload({
        driver,
        key,
        body: Readable.from([pdfOf(4096), randomBytes(60_000)]),
        filename: 'huge.pdf',
        maxBytes: 32_768,
        masterKey: MASTER,
      }),
    ).rejects.toThrow(UploadTooLarge);

    expect(await driver.stat(key)).toBeNull();
  });

  it('refuses an empty file', async () => {
    await expect(
      storeUpload({
        driver,
        key: freshKey(),
        body: Readable.from([]),
        filename: 'nothing.pdf',
        maxBytes: 1024,
        masterKey: MASTER,
      }),
    ).rejects.toThrow(UploadEmpty);
  });

  it('rejects before writing, so a refused upload never occupies a key', async () => {
    const key = freshKey();
    await expect(
      storeUpload({
        driver,
        key,
        body: Readable.from([Buffer.from('<html><script>alert(1)</script></html>')]),
        filename: 'evil.html',
        maxBytes: 1024,
        masterKey: MASTER,
      }),
    ).rejects.toThrow(UploadRejected);

    expect(await driver.stat(key)).toBeNull();
  });

  it('sanitizes the stored filename', async () => {
    const { stored } = await store(pdfOf(512), { filename: '../../../etc/2025 W-2.pdf' });
    expect(stored.filename).toBe('2025 W-2.pdf');
  });

  it('will not decrypt with the wrong key', async () => {
    const { key, stored } = await store(pdfOf(4096));
    await expect(
      openStored({
        driver,
        key,
        encrypted: true,
        envelope: stored.envelope,
        masterKey: parseMasterKey(generateMasterKey()),
      }),
    ).rejects.toThrow();
  });
});

describe('LocalStorage', () => {
  it('reports a missing object rather than an empty one', async () => {
    await expect(driver.open(freshKey())).rejects.toThrow(ObjectMissing);
    expect(await driver.stat(freshKey())).toBeNull();
  });

  it('deletes idempotently', async () => {
    const { key } = await store(pdfOf(1024));
    expect(await driver.stat(key)).not.toBeNull();
    await driver.remove(key);
    await driver.remove(key);
    expect(await driver.stat(key)).toBeNull();
  });

  it('refuses a key that is not the shape Gather generates', async () => {
    await expect(driver.open('../../etc/passwd')).rejects.toThrow(/unexpected storage key/);
    await expect(driver.open('nice-try/../../../etc/passwd.bin')).rejects.toThrow(
      /unexpected storage key/,
    );
    await expect(driver.put('/absolute/path.bin', Readable.from(['x']))).rejects.toThrow(
      /unexpected storage key/,
    );
  });

  it('leaves nothing staged behind when a write fails mid-stream', async () => {
    const key = freshKey();
    const failing = Readable.from(
      (async function* () {
        yield Buffer.from('%PDF-1.7\n');
        throw new Error('connection dropped');
      })(),
    );

    await expect(driver.put(key, failing)).rejects.toThrow('connection dropped');
    expect(await driver.stat(key)).toBeNull();
    await expect(readFile(join(root, '.incoming')).catch(() => 'gone')).resolves.toBe('gone');
  });

  it('round-trips through the driver directly', async () => {
    const key = freshKey();
    await driver.put(key, Readable.from(['plain bytes']));
    expect(await text(await driver.open(key))).toBe('plain bytes');
    expect(await driver.stat(key)).toEqual({ size: 11 });
  });
});
