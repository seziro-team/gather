import { sql } from 'drizzle-orm';
import { getDb, getMigrationStatus } from '@gather/db';

/** Never cached: this is a liveness signal, and Docker's healthcheck polls it. */
export const dynamic = 'force-dynamic';

/**
 * Reports whether Gather can actually serve traffic, not merely whether the process is
 * up: the database must answer and the schema must be current. `docker compose up`
 * waits on this, so it has to mean something.
 */
export async function GET(): Promise<Response> {
  let db: 'ok' | 'unreachable' = 'unreachable';
  let migrations: 'applied' | 'pending' | 'unknown' = 'unknown';
  let detail: string | undefined;

  try {
    const database = getDb();
    await database.execute(sql`select 1`);
    db = 'ok';

    const status = await getMigrationStatus(database);
    migrations = status.status;
    if (status.status === 'pending') {
      detail = `${status.missing.length} migration(s) not applied: ${status.missing.join(', ')}`;
    }
  } catch (error) {
    detail = (error as Error).message;
  }

  const ok = db === 'ok' && migrations === 'applied';
  return Response.json(
    {
      status: ok ? 'ok' : 'degraded',
      db,
      migrations,
      ...(detail ? { detail } : {}),
      checkedAt: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
