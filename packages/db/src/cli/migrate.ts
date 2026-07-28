#!/usr/bin/env node
import { getMigrationStatus } from '../migrations.js';
import { runMigrations } from '../migrator.js';
import { connectFromEnv } from './env.js';

const { pool, db } = connectFromEnv();

try {
  const before = await getMigrationStatus(db);
  if (before.status === 'applied') {
    process.stdout.write(`Migrations already applied (${before.applied}/${before.expected}).\n`);
  } else {
    process.stdout.write(
      `Applying ${before.missing.length} migration(s): ${before.missing.join(', ')}\n`,
    );
    await runMigrations(pool, db);
    const after = await getMigrationStatus(db);
    if (after.status !== 'applied') {
      process.stderr.write(
        `Migration run finished but ${after.missing.length} migration(s) are still missing: ${after.missing.join(', ')}\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`Migrations applied (${after.applied}/${after.expected}).\n`);
  }
} catch (error) {
  process.stderr.write(`Migration failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
