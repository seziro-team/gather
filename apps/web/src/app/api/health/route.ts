import { sql } from 'drizzle-orm';
import { getDb, getMigrationStatus } from '@gather/db';

/** Never cached: an orchestrator polls it, and a cached answer is not an answer. */
export const dynamic = 'force-dynamic';

/**
 * Readiness. Should this instance be sent traffic?
 *
 * The database must answer and the schema must be current — `docker compose up` waits on
 * this, so it has to mean something more than "the process started".
 *
 * Its counterpart is `/api/live`, which checks nothing and exists so that a database blip
 * makes instances *unready* rather than getting them restarted. Point a Kubernetes
 * livenessProbe at `/api/live` and a readinessProbe here.
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
