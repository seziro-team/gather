import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { env } from '@gather/core';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
/** The transaction handle drizzle hands to `db.transaction(...)`. */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createPool(connectionString: string, config: PoolConfig = {}): Pool {
  return new Pool({
    connectionString,
    // Keep the default pool small: Gather is designed to run on a modest VPS alongside
    // Postgres itself, and Next.js server components hold connections only briefly.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...config,
  });
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

interface DbSingleton {
  pool: Pool;
  db: Database;
}

// Next.js replaces the module registry on every hot reload in development; without a
// global handle each reload would leak a connection pool.
const globalRef = globalThis as typeof globalThis & { __gatherDb?: DbSingleton };

export function getDb(): Database {
  return getDbHandles().db;
}

export function getPool(): Pool {
  return getDbHandles().pool;
}

function getDbHandles(): DbSingleton {
  if (!globalRef.__gatherDb) {
    const pool = createPool(env().DATABASE_URL);
    globalRef.__gatherDb = { pool, db: createDatabase(pool) };
  }
  return globalRef.__gatherDb;
}

export async function closeDb(): Promise<void> {
  const current = globalRef.__gatherDb;
  if (!current) return;
  globalRef.__gatherDb = undefined;
  await current.pool.end();
}
