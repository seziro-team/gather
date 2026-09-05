import { Client } from 'pg';

/**
 * Where the destructive integration tests are allowed to run.
 *
 * The tests in this package delete rows, disable the audit log's append-only trigger and
 * truncate tables. That is legitimate — the chain's correctness depends on real Postgres
 * behaviour (advisory locks, jsonb normalisation, timestamptz precision) that a mock
 * cannot reproduce, so there has to be a real database to do it to.
 *
 * What is not legitimate is doing it to the operator's database. Gather is self-hosted:
 * a firm clones this repository onto the machine that holds its clients' tax documents,
 * with a `.env` pointing `DATABASE_URL` at the live install. Falling back to that
 * variable — as this used to — means `pnpm test` silently destroys the audit log the
 * product exists to keep.
 *
 * So the rule is: never the database in `DATABASE_URL`. If `TEST_DATABASE_URL` is set,
 * that is the answer. Otherwise a sibling database named `<db>_test` is created on the
 * same server and used instead, which keeps `pnpm test` working out of the box on a
 * fresh clone without it ever being able to touch real data.
 */

const HINT =
  'Set TEST_DATABASE_URL to a scratch Postgres database, or DATABASE_URL to a server ' +
  'this can create one on. `docker compose up -d db` gives you both.';

export async function testDatabaseUrl(): Promise<string> {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL?.trim();
  if (!base) throw new Error(`No database configured for the test suite. ${HINT}`);

  const url = new URL(base);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) throw new Error(`DATABASE_URL names no database. ${HINT}`);

  // Somebody has already pointed us at something scratch-shaped; take them at their word.
  if (name.endsWith('_test')) return base;

  const scratch = `${name}_test`;
  await ensureDatabase(url, scratch);

  const target = new URL(url.toString());
  target.pathname = `/${encodeURIComponent(scratch)}`;
  return target.toString();
}

/**
 * Create the scratch database if it is not there yet.
 *
 * `CREATE DATABASE` cannot run inside a transaction and has no `IF NOT EXISTS`, so this
 * asks first and tolerates losing the race with a parallel run (23505/42P04).
 */
async function ensureDatabase(server: URL, name: string): Promise<void> {
  // Connect to the maintenance database rather than the one being created.
  const admin = new URL(server.toString());
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not reach Postgres at ${admin.host} to create the scratch database "${name}": ` +
        `${(error as Error).message}. ${HINT}`,
      { cause: error },
    );
  }

  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount === 0) {
      // The name is derived from a connection string the operator controls, not from
      // anything a request could reach, but an identifier still cannot be a bind
      // parameter — so it is quoted rather than interpolated raw.
      await client.query(`create database "${name.replace(/"/g, '""')}"`);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    // 42P04 duplicate_database, 23505 unique_violation — another worker won the race.
    if (code !== '42P04' && code !== '23505') throw error;
  } finally {
    await client.end();
  }
}
