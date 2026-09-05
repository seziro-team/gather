#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { verifyStoredAuditChain } from '../audit.js';
import { parseAuditCsv, verifyAuditRows } from '../audit-export.js';
import { connectFromEnv } from './env.js';

/**
 * Re-verify the audit trail — from the database, or from an exported CSV.
 *
 *   pnpm verify:audit                     # the live chain, needs DATABASE_URL
 *   pnpm verify:audit --csv audit.csv     # an exported file, needs nothing else
 *
 * The second form is the one that matters to somebody who is not the firm. A CSV export
 * carries every event's `prev_hash` and `hash`, so a client, an insurer or an auditor can
 * check it without access to Gather, the database, or anyone's word for it.
 *
 * Exit code 0 = intact, 1 = tampered or truncated, 2 = could not run. The non-zero exit is
 * the point: this is meant to be run from cron or CI, not just read by a human.
 */

const args = process.argv.slice(2);
const csvIndex = args.indexOf('--csv');

if (csvIndex !== -1) {
  const path = args[csvIndex + 1];
  if (!path) {
    process.stderr.write('Usage: verify:audit --csv <file>\n');
    process.exit(2);
  }
  await verifyFile(path);
} else {
  await verifyDatabase();
}

async function verifyFile(path: string): Promise<void> {
  let rows;
  try {
    rows = parseAuditCsv(await readFile(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`Could not read ${path}: ${(error as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  const verdict = verifyAuditRows(rows);

  if (!verdict.rowsIntact) {
    process.stderr.write(`FAIL at id=${verdict.failedAt}: ${verdict.reason}\n`);
    process.stderr.write(`Verified ${verdict.count} event(s) before failing.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `OK: ${verdict.count} events, every row's hash recomputes` +
      `${verdict.head ? ` (head ${verdict.head.slice(0, 12)}…)` : ''}\n`,
  );

  // Said out loud rather than glossed over. A trail filtered to one request has gaps in
  // its ids by construction; reporting "chain intact" would be claiming something this
  // file cannot support.
  if (verdict.chainLinked) {
    process.stdout.write('    and they form an unbroken chain from the first event.\n');
  } else {
    process.stdout.write(
      '    This is a filtered export, so it cannot show whether events are missing.\n' +
        '    Export the whole trail (no request or date filter) for that.\n',
    );
  }
}

async function verifyDatabase(): Promise<void> {
  const { pool, db } = connectFromEnv();
  try {
    const result = await verifyStoredAuditChain(db);
    if (result.ok) {
      process.stdout.write(
        `OK: ${result.count} events, chain intact (head ${result.headHash.slice(0, 12)}…)\n`,
      );
    } else {
      process.stderr.write(`FAIL at id=${result.failedAt}: ${result.reason}\n`);
      process.stderr.write(`Verified ${result.count} event(s) before failing.\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`Could not verify audit chain: ${(error as Error).message}\n`);
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}
