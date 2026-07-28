/**
 * Runs once, before the server accepts its first request.
 *
 * Migrations happen here rather than in a separate container process: the standalone
 * build bundles the workspace packages, so a plain `node packages/db/cli/migrate.js`
 * inside the image would have no node_modules to resolve. Doing it in-process also means
 * the server never serves traffic against a schema it hasn't finished migrating.
 *
 * `runMigrations` takes a Postgres advisory lock, so several replicas booting together
 * is safe: one applies, the others wait and find nothing to do.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { createLogger, isLogLevel } = await import('@gather/core');
  const level = process.env.GATHER_LOG_LEVEL ?? 'info';
  const log = createLogger({
    name: 'gather',
    level: isLogLevel(level) ? level : 'info',
  });

  const autoMigrate = (process.env.GATHER_AUTO_MIGRATE ?? 'true').toLowerCase() !== 'false';
  if (!autoMigrate) {
    log.warn('GATHER_AUTO_MIGRATE=false — skipping migrations; run `pnpm db:migrate` yourself');
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    log.error('DATABASE_URL is not set — cannot start. See .env.example');
    process.exit(1);
  }

  const { createDatabase, createPool, getMigrationStatus } = await import('@gather/db');
  const { runMigrations } = await import('@gather/db/migrator');
  const { seedBuiltinTemplates } = await import('@gather/db/seed');

  const pool = createPool(url, { max: 2 });
  try {
    const database = createDatabase(pool);
    const before = await getMigrationStatus(database);
    if (before.status === 'applied') {
      log.info('database schema is current', { applied: before.applied });
    } else {
      log.info('applying migrations', { pending: before.missing });
      await runMigrations(pool, database);
      const after = await getMigrationStatus(database);
      if (after.status !== 'applied') {
        log.error('migrations did not fully apply', { missing: after.missing });
        process.exit(1);
      }
      log.info('migrations applied', { applied: after.applied });
    }

    // A fresh install with an empty template list would fail the self-host promise before
    // the operator had done anything wrong. Idempotent, and locked against replicas.
    const seeded = await seedBuiltinTemplates(database);
    log.info('built-in templates ready', {
      installed: seeded.installed.length,
      updated: seeded.updated.length,
      unchanged: seeded.unchanged.length,
    });
  } catch (error) {
    log.error('could not prepare the database', { error: (error as Error).message });
    process.exit(1);
  } finally {
    await pool.end();
  }
}
