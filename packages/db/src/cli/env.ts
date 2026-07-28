import { createDatabase, createPool, type Database } from '../client.js';
import type { Pool } from 'pg';

/**
 * CLI entrypoints only ever need a database connection, so they read DATABASE_URL
 * directly instead of the full application environment schema. That keeps
 * `pnpm db:migrate` and `pnpm verify:audit` usable against any database without
 * needing an app secret or a public URL to be set.
 */
export function connectFromEnv(): { pool: Pool; db: Database } {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is not set. See .env.example.\n');
    process.exit(2);
  }
  const pool = createPool(url, { max: 2 });
  return { pool, db: createDatabase(pool) };
}
