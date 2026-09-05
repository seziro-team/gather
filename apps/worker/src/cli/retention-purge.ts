#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createLogger, env, isLogLevel } from '@gather/core';
import { closeDb, getDb, markPurged, purgeCandidates, sweepThrottle } from '@gather/db';
import { LocalStorage, localStoragePath, S3Storage, type StorageDriver } from '@gather/storage';

/**
 * `pnpm retention:purge` — secure disposal, 16 CFR 314.4(c)(6).
 *
 *   pnpm retention:purge                       # what would go, and nothing else
 *   pnpm retention:purge --older-than 365d --confirm
 *
 * Deletes the stored bytes of files belonging to requests the firm marked **complete**
 * more than N days ago. The `file` rows survive with their name, size and SHA-256, and the
 * audit trail records every disposal — because "there was a document here, it hashed to
 * this, and it was disposed of on this date" is the record disposal is supposed to leave.
 *
 * Two guards, both deliberate. It is a **dry run by default**: nothing is deleted without
 * `--confirm`. And the default retention is `0`, meaning never — deleting a firm's client
 * documents on a timer they did not set is not a decision Gather gets to make.
 */

function parseDays(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = /^(\d+)\s*(d|days?)?$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Could not read "${value}" as a number of days. Try --older-than 365d.`);
  }
  return Number(match[1]);
}

/**
 * The driver that holds a particular file, which is not necessarily the configured one.
 *
 * A firm that started on local disk and moved to S3 has files under both, and a purge that
 * only looked at the current driver would silently leave half of them on the disk while
 * reporting success.
 */
function driverFor(name: string): StorageDriver {
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
    `A file is stored with the "${name}" driver, which is not configured. Set the S3_* ` +
      `variables so the purge can reach it, or it would report success without deleting it.`,
  );
}

/**
 * Find and load the repository's `.env`.
 *
 * Run from a source checkout this needs the same configuration the app has — including the
 * storage settings, without which it cannot find the files it is meant to delete. Searching
 * upward rather than reading `./.env` because pnpm runs a workspace script with the *package*
 * as the working directory, so the file is two levels above wherever this starts.
 *
 * `loadEnvFile` never overwrites a variable that is already set, so an explicit one and the
 * container's own environment both still win.
 */
function loadNearestEnv(): void {
  let directory = resolve(process.env.INIT_CWD ?? process.cwd());

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

loadNearestEnv();

/**
 * Pick up the secret the container generated on first boot.
 *
 * `docker compose exec` starts a process without running the entrypoint, so the variable
 * the entrypoint exports is not there — and the shared environment schema requires it.
 *
 * This command signs nothing and serves nothing, so it does not *need* the secret. It
 * reads it rather than inventing a placeholder to satisfy a validator, because teaching an
 * operator that security-relevant values can be made up to get past a check is a worse
 * habit than a few lines here.
 */
function loadGeneratedSecret(): void {
  if (process.env.GATHER_AUTH_SECRET) return;

  const dataDir = process.env.GATHER_DATA_DIR ?? './data';
  const secretFile = join(dataDir, 'auth-secret');
  if (!existsSync(secretFile)) return;

  const secret = readFileSync(secretFile, 'utf8').trim();
  if (secret) process.env.GATHER_AUTH_SECRET = secret;
}

loadGeneratedSecret();

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const olderThanIndex = args.indexOf('--older-than');
  const config = env();

  const level = process.env.GATHER_LOG_LEVEL;
  const log = createLogger({
    name: 'gather-retention',
    level: level && isLogLevel(level) ? level : config.GATHER_LOG_LEVEL,
  });

  let days: number;
  try {
    days = parseDays(
      olderThanIndex === -1 ? undefined : args[olderThanIndex + 1],
      config.GATHER_RETENTION_DAYS,
    );
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }

  if (days === 0 && olderThanIndex === -1) {
    process.stdout.write(
      'Retention is off (GATHER_RETENTION_DAYS=0), so nothing is eligible.\n' +
        'Set it in .env, or pass --older-than 365d for a one-off run.\n',
    );
    return 0;
  }

  const before = new Date(Date.now() - days * 86_400_000);
  const db = getDb();
  const candidates = await purgeCandidates(db, before);

  process.stdout.write(
    `${candidates.length} file(s) belong to requests completed before ${before.toISOString()}.\n`,
  );

  if (candidates.length === 0) return 0;

  const bytes = candidates.reduce((total, entry) => total + entry.size, 0);
  process.stdout.write(`${(bytes / 1024 / 1024).toFixed(1)} MB of stored data.\n\n`);

  if (!confirm) {
    for (const candidate of candidates.slice(0, 20)) {
      process.stdout.write(
        `  ${candidate.sha256.slice(0, 12)}  ${candidate.originalName}  (${candidate.storageDriver})\n`,
      );
    }
    if (candidates.length > 20) process.stdout.write(`  …and ${candidates.length - 20} more.\n`);
    process.stdout.write(
      '\nNothing was deleted. Re-run with --confirm to dispose of these permanently.\n' +
        'The file records and the audit trail are kept either way.\n',
    );
    return 0;
  }

  const drivers = new Map<string, StorageDriver>();
  let purged = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      let driver = drivers.get(candidate.storageDriver);
      if (!driver) {
        driver = driverFor(candidate.storageDriver);
        drivers.set(candidate.storageDriver, driver);
      }

      // The object goes first. A row marked purged whose bytes are still on the disk is
      // the one outcome that would make this feature a lie.
      await driver.remove(candidate.storageKey);
      await markPurged(db, candidate);
      purged += 1;
    } catch (error) {
      failed += 1;
      log.error('could not dispose of a file', {
        fileId: candidate.fileId,
        driver: candidate.storageDriver,
        error: (error as Error).message,
      });
    }
  }

  // Cheap and in the same neighbourhood: rate-limit buckets whose window closed long ago
  // are rows nothing will ever read again.
  const swept = await sweepThrottle(db, new Date(Date.now() - 86_400_000));

  process.stdout.write(
    `\nDisposed of ${purged} file(s)${failed > 0 ? `, ${failed} failed` : ''}. ` +
      `Records and audit trail kept.\n` +
      `Swept ${swept} expired rate-limit bucket(s).\n`,
  );

  return failed > 0 ? 1 : 0;
}

let code = 2;
try {
  code = await main();
} catch (error) {
  process.stderr.write(`Retention purge failed: ${(error as Error).message}\n`);
} finally {
  await closeDb();
}
process.exitCode = code;
