#!/usr/bin/env node
import { createLogger, env, isLogLevel } from '@gather/core';
import {
  closeDb,
  countWrappedFiles,
  getDb,
  recordAuditEvent,
  storeRewrappedDek,
  wrappedFilesAfter,
} from '@gather/db';
import { canUnwrap, EncryptionKeyError, parseMasterKey, rewrapDek } from '@gather/storage';

/**
 * `pnpm keys:rotate` — move every stored file onto a new encryption key.
 *
 *   GATHER_ENCRYPTION_KEY_NEW="$(openssl rand -base64 32)" pnpm keys:rotate
 *   GATHER_ENCRYPTION_KEY_NEW=... pnpm keys:rotate --confirm
 *
 * Rotation used to be a documented gap here: "if the key is exposed there is no supported
 * way to re-encrypt". There is now, and it is cheap, because of how the files were
 * encrypted in the first place. Each file has its own random key; only *that* key is
 * wrapped with the master key. So rotating means unwrapping sixty bytes per file and
 * wrapping them again. **No object is read and no ciphertext is rewritten** — a firm with
 * a terabyte of documents rotates in about the time it takes to update a column.
 *
 * Three properties worth knowing before you run it:
 *
 * - **Dry run by default.** Nothing is written without `--confirm`.
 * - **Resumable and safe to re-run.** A file already carrying the new key is recognised and
 *   skipped, so an interrupted rotation is simply one that has not finished.
 * - **It does not switch you over.** When it finishes, the files are readable only with the
 *   new key, and it is your job to put that key in `GATHER_ENCRYPTION_KEY` and restart.
 *   The CLI says so; it cannot edit your secret store, and pretending otherwise would be
 *   the one failure mode that loses documents.
 */

const rawLevel = process.env.GATHER_LOG_LEVEL;
const log = createLogger({
  name: 'keys:rotate',
  level: rawLevel && isLogLevel(rawLevel) ? rawLevel : 'info',
});

const BATCH = 500;

function usage(message: string): never {
  log.error(message);
  console.error(`
Usage:
  GATHER_ENCRYPTION_KEY_NEW="$(openssl rand -base64 32)" pnpm keys:rotate [--confirm]

  GATHER_ENCRYPTION_KEY      the key the files are encrypted with now
  GATHER_ENCRYPTION_KEY_NEW  the key to move them to

Without --confirm this reports what it would do and changes nothing.
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const config = env();

  if (config.STORAGE_ENCRYPTION !== 'on') {
    usage('STORAGE_ENCRYPTION is off on this install, so no file has a key to rotate.');
  }
  if (!config.GATHER_ENCRYPTION_KEY) {
    usage('GATHER_ENCRYPTION_KEY is not set, so there is no current key to rotate away from.');
  }

  const rawNew = process.env.GATHER_ENCRYPTION_KEY_NEW?.trim();
  if (!rawNew) usage('GATHER_ENCRYPTION_KEY_NEW is not set. Generate one: openssl rand -base64 32');

  let currentKey: Buffer;
  let nextKey: Buffer;
  try {
    currentKey = parseMasterKey(config.GATHER_ENCRYPTION_KEY);
    nextKey = parseMasterKey(rawNew, 'GATHER_ENCRYPTION_KEY_NEW');
  } catch (error) {
    usage((error as Error).message);
  }

  if (currentKey.equals(nextKey)) {
    usage('GATHER_ENCRYPTION_KEY_NEW is the same as the current key. That would rotate nothing.');
  }

  const db = getDb();
  const total = await countWrappedFiles(db);
  log.info(confirm ? 'rotating' : 'dry run — nothing will be written', { files: total });

  let cursor: string | null = null;
  let rotated = 0;
  let alreadyDone = 0;
  const failures: { fileId: string; storageKey: string; reason: string }[] = [];

  for (;;) {
    const batch = await wrappedFilesAfter(db, cursor, BATCH);
    if (batch.length === 0) break;

    for (const row of batch) {
      cursor = row.id;

      // Already rotated — a resumed run, or a second one. Recognised rather than retried,
      // which is what makes an interrupted rotation harmless.
      if (canUnwrap(nextKey, row.storageKey, row.dekWrapped)) {
        alreadyDone += 1;
        continue;
      }

      try {
        const rewrapped = rewrapDek(currentKey, nextKey, row.storageKey, row.dekWrapped);
        if (confirm) await storeRewrappedDek(db, row.id, rewrapped);
        rotated += 1;
      } catch (error) {
        // Keep going. One file wrapped with a third key — restored from an old backup,
        // say — must not stop the other ten thousand from rotating, and the list of what
        // did not move is more useful than a stack trace at the first one.
        const reason =
          error instanceof EncryptionKeyError ? error.message : (error as Error).message;
        failures.push({ fileId: row.id, storageKey: row.storageKey, reason });
      }
    }

    log.info('progress', { seen: rotated + alreadyDone + failures.length, of: total });
  }

  if (confirm) {
    // One row for the whole rotation, not one per file: this is an operational act by the
    // person holding the keys, and ten thousand identical rows would bury the trail.
    await recordAuditEvent(db, {
      action: 'security.key_rotated',
      actorType: 'system',
      targetType: 'encryption_key',
      metadata: { rotated, alreadySoFar: alreadyDone, failed: failures.length, total },
    });
  }

  console.log(`
${confirm ? 'Rotated' : 'Would rotate'}: ${rotated}
Already on the new key:  ${alreadyDone}
Could not be rotated:    ${failures.length}
Total encrypted files:   ${total}
`);

  for (const failure of failures.slice(0, 20)) {
    console.error(`  ! ${failure.storageKey} — ${failure.reason}`);
  }
  if (failures.length > 20) console.error(`  … and ${failures.length - 20} more`);

  if (!confirm) {
    console.log('Dry run. Re-run with --confirm to write the new key material.\n');
    return;
  }

  if (failures.length > 0) {
    console.error(
      '\n⚠️  Some files did not rotate. They are still readable with the OLD key, so do not\n' +
        '   discard it until they are resolved.\n',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    'Done. Every file is now wrapped with the new key — and readable ONLY with it.\n\n' +
      'Next, and Gather cannot do this part for you:\n' +
      '  1. Put the new key in GATHER_ENCRYPTION_KEY (your .env or your secret store).\n' +
      '  2. Restart the web and worker containers.\n' +
      '  3. Download one file and check it opens.\n' +
      '  4. Only then destroy the old key.\n',
  );
}

try {
  await main();
} catch (error) {
  log.error('rotation failed', { error: (error as Error).message });
  process.exitCode = 1;
} finally {
  await closeDb();
}
