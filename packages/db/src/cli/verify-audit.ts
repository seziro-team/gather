#!/usr/bin/env node
import { verifyStoredAuditChain } from '../audit.js';
import { connectFromEnv } from './env.js';

/**
 * Re-verifies the whole audit chain against the database.
 *
 * Exit code 0 = intact, 1 = tampered or truncated, 2 = could not run. The non-zero exit
 * is the point: this is meant to be run from cron or CI, not just read by a human.
 */
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
