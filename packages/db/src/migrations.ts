import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Resolved from this module so it works identically from `dist/` inside the container.
 *
 * Built with path.join rather than `new URL('../drizzle', import.meta.url)`: bundlers
 * treat the latter as a static asset reference and fail the build trying to resolve a
 * directory that only exists at runtime.
 */
export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

export async function readJournal(): Promise<JournalEntry[]> {
  const raw = await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(raw) as Journal).entries;
}

/** Drizzle wraps driver errors in DrizzleQueryError, so unwrap before reading SQLSTATE. */
function hasPgErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface MigrationStatus {
  status: 'applied' | 'pending';
  applied: number;
  expected: number;
  /** Tags present in the repository but not yet in the database. */
  missing: string[];
}

/**
 * Compare the migration journal shipped with this build against what the database has
 * actually run. The health endpoint reports this so `docker compose up` can be trusted:
 * "ok" means the schema is genuinely current, not merely that Postgres answered.
 */
export async function getMigrationStatus(db: Database): Promise<MigrationStatus> {
  const entries = await readJournal();

  let appliedAt: number[] = [];
  try {
    const result = await db.execute<{ created_at: string }>(
      sql`select created_at from drizzle.__drizzle_migrations`,
    );
    appliedAt = result.rows.map((row) => Number(row.created_at));
  } catch (error) {
    // 42P01 = undefined_table: migrations have never been run against this database,
    // so the empty list it was initialised with is the right answer.
    if (!hasPgErrorCode(error, '42P01')) throw error;
  }

  const appliedSet = new Set(appliedAt);
  const missing = entries.filter((entry) => !appliedSet.has(entry.when)).map((entry) => entry.tag);

  return {
    status: missing.length === 0 ? 'applied' : 'pending',
    applied: appliedAt.length,
    expected: entries.length,
    missing,
  };
}
