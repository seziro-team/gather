import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import {
  canUnwrap,
  createDecryptor,
  createEncryptor,
  EncryptionKeyError,
  generateMasterKey,
  parseMasterKey,
  rewrapDek,
  type Envelope,
} from './crypto.js';

const KEY = () => parseMasterKey(generateMasterKey());
const OBJECT_KEY = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.bin';

async function encrypt(master: Buffer, key: string, plaintext: Buffer) {
  const encryptor = createEncryptor(master, key);
  const ciphertext = await buffer(Readable.from([plaintext]).pipe(encryptor.cipher));
  return { ciphertext, envelope: encryptor.envelope() };
}

async function decrypt(master: Buffer, key: string, ciphertext: Buffer, envelope: Envelope) {
  const decipher = createDecryptor(master, key, envelope);
  return buffer(Readable.from([ciphertext]).pipe(decipher));
}

describe('parseMasterKey', () => {
  it('accepts base64 and hex of exactly 32 bytes', () => {
    const raw = randomBytes(32);
    expect(parseMasterKey(raw.toString('base64'))).toEqual(raw);
    expect(parseMasterKey(raw.toString('hex'))).toEqual(raw);
    expect(parseMasterKey(raw.toString('base64url'))).toEqual(raw);
    expect(parseMasterKey(` ${raw.toString('base64')} \n`)).toEqual(raw);
  });

  it('refuses a key that is the wrong size, rather than padding or truncating it', () => {
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow(EncryptionKeyError);
    expect(() => parseMasterKey(randomBytes(64).toString('base64'))).toThrow(EncryptionKeyError);
    expect(() => parseMasterKey('')).toThrow(EncryptionKeyError);
    expect(() => parseMasterKey('not a key at all')).toThrow(EncryptionKeyError);
  });

  it('names the variable in the message, so the operator knows what to fix', () => {
    expect(() => parseMasterKey('short', 'MY_KEY')).toThrow(/MY_KEY/);
  });

  it('generates keys that parse', () => {
    expect(parseMasterKey(generateMasterKey())).toHaveLength(32);
  });
});

describe('envelope encryption', () => {
  it('round-trips content of every awkward size', async () => {
    const master = KEY();
    for (const size of [1, 15, 16, 17, 4096, 100_000]) {
      const plaintext = randomBytes(size);
      const { ciphertext, envelope } = await encrypt(master, OBJECT_KEY, plaintext);
      // GCM is a stream mode: the stored object is the same length as the document.
      expect(ciphertext).toHaveLength(size);
      expect(ciphertext.equals(plaintext)).toBe(false);
      expect(await decrypt(master, OBJECT_KEY, ciphertext, envelope)).toEqual(plaintext);
    }
  });

  it('gives every file its own key, so two identical documents share no bytes', async () => {
    const master = KEY();
    const plaintext = Buffer.from('the same W-2 uploaded twice');
    const first = await encrypt(master, OBJECT_KEY, plaintext);
    const second = await encrypt(master, OBJECT_KEY, plaintext);

    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
    expect(first.envelope.dekWrapped).not.toBe(second.envelope.dekWrapped);
    expect(first.envelope.iv).not.toBe(second.envelope.iv);
  });

  it('cannot be read with a different master key', async () => {
    const plaintext = randomBytes(2048);
    const { ciphertext, envelope } = await encrypt(KEY(), OBJECT_KEY, plaintext);
    expect(() => createDecryptor(KEY(), OBJECT_KEY, envelope)).toThrow(EncryptionKeyError);
    expect(ciphertext).toHaveLength(2048);
  });

  it('binds key material to the object it belongs to', async () => {
    const master = KEY();
    const { envelope } = await encrypt(master, OBJECT_KEY, randomBytes(64));
    const otherKey = OBJECT_KEY.replace('/2', '/3');

    // Moving `dek_wrapped` onto a different file row fails to unwrap at all.
    expect(() => createDecryptor(master, otherKey, envelope)).toThrow(EncryptionKeyError);
  });

  it('detects a single flipped bit in the stored object', async () => {
    const master = KEY();
    const plaintext = randomBytes(5000);
    const { ciphertext, envelope } = await encrypt(master, OBJECT_KEY, plaintext);

    const corrupted = Buffer.from(ciphertext);
    corrupted[1234] ^= 0x01;

    await expect(decrypt(master, OBJECT_KEY, corrupted, envelope)).rejects.toThrow();
  });

  it('detects truncation', async () => {
    const master = KEY();
    const { ciphertext, envelope } = await encrypt(master, OBJECT_KEY, randomBytes(5000));
    await expect(
      decrypt(master, OBJECT_KEY, ciphertext.subarray(0, 4000), envelope),
    ).rejects.toThrow();
  });

  it('refuses a tag or IV of the wrong length rather than guessing', async () => {
    const master = KEY();
    const { envelope } = await encrypt(master, OBJECT_KEY, randomBytes(32));
    expect(() =>
      createDecryptor(master, OBJECT_KEY, { ...envelope, iv: Buffer.alloc(8).toString('base64') }),
    ).toThrow(EncryptionKeyError);
    expect(() =>
      createDecryptor(master, OBJECT_KEY, { ...envelope, tag: Buffer.alloc(4).toString('base64') }),
    ).toThrow(EncryptionKeyError);
    expect(() => createDecryptor(master, OBJECT_KEY, { ...envelope, dekWrapped: 'AAAA' })).toThrow(
      EncryptionKeyError,
    );
  });
});

describe('rotating the master key', () => {
  const storageKey = 'firms/abc/requests/def/files/ghi';

  it('re-wraps the DEK so the same ciphertext opens under the new key', async () => {
    const oldMaster = parseMasterKey(generateMasterKey());
    const newMaster = parseMasterKey(generateMasterKey());
    const plaintext = Buffer.from('the client’s bank statement, 42 pages');

    const encryptor = createEncryptor(oldMaster, storageKey);
    const ciphertext = Buffer.concat([
      encryptor.cipher.update(plaintext),
      encryptor.cipher.final(),
    ]);
    const envelope = encryptor.envelope();

    // The whole point: only the wrapped key changes. Nothing reads or rewrites the object,
    // which is why rotating a terabyte costs the same as rotating a byte.
    const rewrapped = rewrapDek(oldMaster, newMaster, storageKey, envelope.dekWrapped);
    expect(rewrapped).not.toBe(envelope.dekWrapped);

    const decryptor = createDecryptor(newMaster, storageKey, {
      ...envelope,
      dekWrapped: rewrapped,
    });
    const recovered = Buffer.concat([decryptor.update(ciphertext), decryptor.final()]);
    expect(recovered.toString()).toBe(plaintext.toString());
  });

  it('leaves the old key unable to open a rotated file', async () => {
    const oldMaster = parseMasterKey(generateMasterKey());
    const newMaster = parseMasterKey(generateMasterKey());
    const encryptor = createEncryptor(oldMaster, storageKey);
    encryptor.cipher.final();
    const envelope = encryptor.envelope();
    const rewrapped = rewrapDek(oldMaster, newMaster, storageKey, envelope.dekWrapped);

    // Rotation that left the old key working would not be rotation.
    expect(canUnwrap(oldMaster, storageKey, rewrapped)).toBe(false);
    expect(canUnwrap(newMaster, storageKey, rewrapped)).toBe(true);
  });

  it('tells a rotated file from an unrotated one, so a rerun is safe', async () => {
    // What makes the CLI resumable: an interrupted rotation is just one that has not
    // finished, and running it again skips what it already did.
    const oldMaster = parseMasterKey(generateMasterKey());
    const newMaster = parseMasterKey(generateMasterKey());
    const encryptor = createEncryptor(oldMaster, storageKey);
    encryptor.cipher.final();
    const { dekWrapped } = encryptor.envelope();

    expect(canUnwrap(newMaster, storageKey, dekWrapped)).toBe(false);
    expect(canUnwrap(oldMaster, storageKey, dekWrapped)).toBe(true);
  });

  it('refuses to move key material between files', async () => {
    // The AAD binds the wrapped DEK to its object. Without that, swapping `dek_wrapped`
    // between two rows would unwrap cleanly and hand one client's key to another's file.
    const oldMaster = parseMasterKey(generateMasterKey());
    const newMaster = parseMasterKey(generateMasterKey());
    const encryptor = createEncryptor(oldMaster, storageKey);
    encryptor.cipher.final();
    const { dekWrapped } = encryptor.envelope();

    expect(() =>
      rewrapDek(oldMaster, newMaster, 'firms/abc/requests/def/files/SOMEBODY-ELSE', dekWrapped),
    ).toThrow(EncryptionKeyError);
  });
});
