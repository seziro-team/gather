import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import type { Database } from './client.js';
import { MIGRATIONS_FOLDER } from './migrations.js';

/**
 * Kept out of the package's main entrypoint so the web app never bundles drizzle-kit's
 * migrator: only the CLI and the container entrypoint need it.
 *
 * Guarded by a session-level advisory lock so several replicas booting at once cannot
 * race each other into a half-applied schema.
 */
export async function runMigrations(pool: Pool, db: Database): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(8410570002)');
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.query('select pg_advisory_unlock(8410570002)');
    client.release();
  }
}
