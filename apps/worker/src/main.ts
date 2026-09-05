import { PgBoss, type Job } from 'pg-boss';
import { createLogger, env, isLogLevel, type Env, type Logger } from '@gather/core';
import { closeDb, getDb, getPool } from '@gather/db';
import { createMail, mailConfigured, type MailDriver } from '@gather/mail';
import { runReminderScan } from '@gather/reminders';

/**
 * The Gather worker.
 *
 * One job: notice that a reminder has come due and send it. It runs as its own container
 * so that a slow mail server cannot make the web app slow, and so that restarting the
 * sender does not sign every firm user out.
 *
 * pg-boss (MIT) provides the cron, the retries and the locking, on **Postgres alone** —
 * plan.md §4's hard rule is that Gather requires no second service, and a queue was the
 * most likely thing to break it. Verified against pg-boss 12.30.0: `createQueue` before
 * `work`/`send`, handlers receive a batch (`Job[]`), and `schedule()` takes a cron string.
 *
 * The reminder logic itself lives in @gather/reminders, which the web app also calls for
 * manual nudges. This file is scheduling and lifecycle, nothing else.
 */

const SCAN_QUEUE = 'reminder.scan';

/**
 * The cron entry that wakes the scan up.
 *
 * The cadence decides when a reminder is *due*; this only decides how promptly a due one
 * is noticed. Every minute by default, which is well under the resolution anyone
 * configures — a firm setting "every 3 days at 09:00" cannot tell the difference between
 * 09:00 and 09:00:59, and a busier install can widen it.
 */
function scanCron(everyMinutes: number): string {
  return everyMinutes === 1 ? '* * * * *' : `*/${everyMinutes} * * * *`;
}

interface Runtime {
  boss: PgBoss;
  logger: Logger;
  mail: MailDriver;
  config: Env;
}

async function start(): Promise<Runtime> {
  const config = env();
  const level = process.env.GATHER_LOG_LEVEL;
  const logger = createLogger({
    name: 'gather-worker',
    level: level && isLogLevel(level) ? level : config.GATHER_LOG_LEVEL,
  });

  if (!mailConfigured(config)) {
    // Not a crash: an install with no mail configured is a perfectly valid Gather, and the
    // UI already says reminders are unavailable. Saying so once at boot beats a warning
    // every sixty seconds forever.
    logger.warn(
      'no email is configured (MAIL_DRIVER=none) — the worker will run, but every reminder ' +
        'it finds will fail. Set MAIL_DRIVER to "resend" or "smtp" to turn reminders on.',
    );
  }

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    // pg-boss keeps its own tables out of the way of Gather's schema and its migrations.
    schema: 'pgboss',
    application_name: 'gather-worker',
    max: 4,
  });

  boss.on('error', (error: Error) => logger.error('pg-boss error', { error }));

  await boss.start();

  // Required since pg-boss 10: a queue has to exist before anything can be sent to it or
  // worked from it.
  await boss.createQueue(SCAN_QUEUE, {
    // One scan at a time, cluster-wide. Two overlapping scans would still be safe — the
    // unique index in reminder_log sees to that — but they would fight over row locks for
    // no benefit.
    policy: 'singleton',
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    // A scan that has not finished in five minutes is wedged; let it be retried.
    expireInSeconds: 300,
    deleteAfterSeconds: 3600,
  });

  const mail = createMail(config);

  await boss.work<{ trigger?: string }>(
    SCAN_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 5 },
    async (jobs: Job<{ trigger?: string }>[]) => {
      // pg-boss hands the handler a batch; with batchSize 1 that is one job, but the
      // signature is an array and pretending otherwise is how a silent drop happens.
      for (const job of jobs) {
        const result = await runReminderScan({ db: getDb(), mail, logger, config });
        if (result.considered > 0) {
          logger.info('reminder scan finished', {
            ...result,
            trigger: job.data?.trigger ?? 'cron',
          });
        } else {
          logger.debug('reminder scan finished', { ...result });
        }
      }
    },
  );

  const cron = scanCron(config.GATHER_REMINDER_SCAN_MINUTES);
  await boss.schedule(SCAN_QUEUE, cron, { trigger: 'cron' }, { tz: 'UTC' });

  logger.info('gather worker ready', {
    driver: mail.name,
    scanCron: cron,
    batch: config.GATHER_REMINDER_BATCH,
  });

  return { boss, logger, mail, config };
}

/**
 * Shut down without abandoning a send.
 *
 * `boss.stop({ graceful: true })` lets an in-flight scan finish, which matters: a scan killed
 * between claiming a reminder and recording its outcome leaves a row saying `queued` for a
 * message that may or may not have gone out. Being killed is survivable — the idempotency
 * key means the reminder is never sent twice — but finishing cleanly is better.
 */
async function shutdown(runtime: Runtime, signal: string): Promise<void> {
  runtime.logger.info('shutting down', { signal });
  try {
    // `graceful` lets an in-flight scan finish rather than cutting it off mid-send.
    await runtime.boss.stop({ graceful: true, timeout: 20_000, close: true });
    await runtime.mail.close?.();
    await closeDb();
  } catch (error) {
    runtime.logger.error('shutdown was not clean', { error });
  }
  process.exit(0);
}

const runtime = await start().catch((error: unknown) => {
  // Before the logger exists there is nowhere structured to put this.
  process.stderr.write(
    `gather worker failed to start: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(runtime, signal));
}

process.on('unhandledRejection', (reason) => {
  runtime.logger.error('unhandled rejection', { error: reason });
});

// Keeps the pool from being garbage-collected in a build that tree-shakes aggressively,
// and gives `docker compose exec` something to look at.
void getPool();
