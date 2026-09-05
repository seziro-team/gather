import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { assertValidKey, ObjectMissing, type StorageDriver } from './driver.js';

/**
 * Files on a disk. The default, and the one most self-hosters should stay on.
 *
 * plan.md §4.2: the brief asked for MinIO by default; MinIO's community repository was
 * archived in April 2026 and ships no binaries. A directory needs no service at all, which
 * is what keeps `docker compose up` a five-minute install.
 */
export class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  get location(): string {
    return this.root;
  }

  private path(key: string): string {
    assertValidKey(key);
    const full = join(this.root, key);
    // `assertValidKey` already makes traversal impossible; this is the assertion that
    // says so out loud, and survives someone loosening the pattern later.
    if (full !== resolve(full) || !full.startsWith(`${this.root}/`)) {
      throw new Error('Refusing to write outside the storage root');
    }
    return full;
  }

  async put(key: string, body: Readable): Promise<void> {
    const target = this.path(key);
    const staging = join(this.root, '.incoming');
    await mkdir(staging, { recursive: true });
    await mkdir(dirname(target), { recursive: true });

    // Written aside and moved into place, so a connection that drops halfway leaves a
    // stray file in .incoming rather than a truncated object under a real key. Same
    // filesystem, so the rename is atomic.
    const temporary = join(staging, randomUUID());
    try {
      await pipeline(body, createWriteStream(temporary, { mode: 0o600 }));
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async open(key: string): Promise<Readable> {
    const target = this.path(key);
    try {
      await stat(target);
    } catch {
      throw new ObjectMissing(key);
    }
    return createReadStream(target);
  }

  async remove(key: string): Promise<void> {
    const target = this.path(key);
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    // Leave the per-request directory behind only while it still holds something.
    await rm(dirname(target), { recursive: false }).catch(() => undefined);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const info = await stat(this.path(key));
      return { size: info.size };
    } catch {
      return null;
    }
  }
}
