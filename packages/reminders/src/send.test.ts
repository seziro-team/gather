import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, defaultCadence, loadEnv, type Cadence, type Env } from '@gather/core';
import {
  createDatabase,
  createPool,
  runMigrations,
  testDatabaseUrl,
  upsertSchedule,
  type Database,
} from '@gather/db';
import { MailError, type MailDriver, type MailMessage, type SentMail } from '@gather/mail';
import { runReminderScan } from './send.js';

/**
 * The reminder engine against a real database.
 *
 * The mail driver is a recording stand-in — the point of these tests is what happens
 * *around* a send: whether a schedule is picked up, whether a second attempt is refused,
 * what a retryable failure does to `next_run_at` versus a permanent one. Whether SMTP works
 * is proven by `e2e/reminders.spec.ts` against a real server, not here.
 *
 * The database is not a stand-in, and cannot be: `FOR UPDATE SKIP LOCKED` and a unique
 * index are the entire send-once guarantee, and neither exists outside Postgres.
 */

let pool: Pool;
let db: Database;
let config: Env;

/** Records what it was asked to send, and can be told to fail. */
class RecordingMail implements MailDriver {
  readonly name = 'recording';
  readonly sent: MailMessage[] = [];
  failure: MailError | null = null;

  send(message: MailMessage): Promise<SentMail> {
    if (this.failure) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve({
      providerMessageId: `rec_${this.sent.length}`,
      driver: this.name,
    });
  }
}

const logger = createLogger({ level: 'error', write: () => {} });

beforeAll(async () => {
  const url = await testDatabaseUrl();
  pool = createPool(url, { max: 6 });
  db = createDatabase(pool);
  await runMigrations(pool, db);

  config = loadEnv({
    DATABASE_URL: url,
    GATHER_APP_URL: 'https://gather.example',
    GATHER_AUTH_SECRET: 'a'.repeat(48),
    NODE_ENV: 'test',
  });
});

afterAll(async () => {
  await pool.end();
});

interface Fixture {
  requestId: string;
  firmId: string;
  clientEmail: string;
  scheduleId: string;
  itemId: string;
}

/** A firm, a client, a sent request with one required item, and a schedule. */
async function seed(
  options: { cadence?: Cadence; email?: string; itemType?: 'file' | 'text' } = {},
): Promise<Fixture> {
  const firmId = randomUUID();
  const clientId = randomUUID();
  const requestId = randomUUID();
  const sectionId = randomUUID();
  const itemId = randomUUID();
  const email = options.email === undefined ? `rosa-${randomUUID()}@example.test` : options.email;

  await db.execute(sql`
    insert into firm (id, name, slug, brand_color, timezone)
    values (${firmId}, 'Delgado & Co', ${`delgado-${firmId.slice(0, 8)}`}, '#0f766e', 'Europe/London')
  `);
  await db.execute(sql`
    insert into client (id, firm_id, name, email)
    values (${clientId}, ${firmId}, 'Rosa Delgado', ${email})
  `);
  await db.execute(sql`
    insert into request (id, firm_id, client_id, title, status, sent_at)
    values (${requestId}, ${firmId}, ${clientId}, 'Year-end documents', 'sent', now() - interval '10 days')
  `);
  await db.execute(sql`
    insert into section (id, request_id, title, position)
    values (${sectionId}, ${requestId}, 'What we need', 0)
  `);
  await db.execute(sql`
    insert into item (id, section_id, type, label, required, position, config)
    values (${itemId}, ${sectionId}, ${options.itemType ?? 'file'}, 'Bank statements', true, 0, '{}'::jsonb)
  `);

  const schedule = await upsertSchedule(db, {
    requestId,
    cadence: options.cadence ?? defaultCadence('Europe/London'),
    // Due a minute ago.
    nextRunAt: new Date(Date.now() - 60_000),
    active: true,
  });

  return { requestId, firmId, clientEmail: email, scheduleId: schedule.id, itemId };
}

beforeEach(async () => {
  // A due schedule left behind by an earlier test is a due schedule the next scan will
  // find, so isolation here is not tidiness — without it every assertion about
  // `considered` counts the whole file. Deleting the firm cascades through client,
  // request, section, item, response, schedule and log.
  await db.execute(sql`delete from firm`);

  await db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_event`);
  await db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_head`);
});

function deps(mail: RecordingMail) {
  return { db, mail, logger, config };
}

describe('the reminder scan', () => {
  it('sends a due reminder and moves the schedule on', async () => {
    const mail = new RecordingMail();
    const fixture = await seed();

    const result = await runReminderScan(deps(mail));
    expect(result).toMatchObject({ considered: 1, sent: 1, failed: 0, stopped: 0 });

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe(fixture.clientEmail);
    expect(mail.sent[0]!.text).toContain('Bank statements');
    expect(mail.sent[0]!.text).toContain(`https://gather.example/portal/${fixture.requestId}`);
    expect(mail.sent[0]!.idempotencyKey).toBe(`schedule:${fixture.scheduleId}:0`);

    const { rows } = await db.execute<{
      sent_count: number;
      active: boolean;
      next_run_at: Date;
    }>(sql`
      select sent_count, active, next_run_at from reminder_schedule where id = ${fixture.scheduleId}
    `);
    expect(rows[0]).toMatchObject({ sent_count: 1, active: true });
    expect(new Date(rows[0]!.next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses to send the same reminder twice', async () => {
    const mail = new RecordingMail();
    const fixture = await seed();

    await runReminderScan(deps(mail));
    expect(mail.sent).toHaveLength(1);

    // A crash between the claim and the send leaves the row and no email. Re-arm the
    // schedule *without* advancing sent_count, which is what that looks like.
    await db.execute(sql`
      update reminder_schedule
         set next_run_at = now() - interval '1 minute', sent_count = 0
       where id = ${fixture.scheduleId}
    `);

    const second = await runReminderScan(deps(mail));
    expect(second).toMatchObject({ considered: 1, sent: 0 });
    expect(mail.sent, 'a second copy of the same reminder was sent').toHaveLength(1);

    const { rows: counted } = await db.execute<{ n: string }>(sql`
      select count(*) as n from reminder_log where request_id = ${fixture.requestId}
    `);
    expect(Number(counted[0]!.n)).toBe(1);
  });

  it('stops rather than chasing a client who has nothing outstanding', async () => {
    const mail = new RecordingMail();
    // A text item, because a `file` item is answered by an uploaded file rather than by
    // a value — and what is under test here is "nothing outstanding", not the item types.
    const fixture = await seed({ itemType: 'text' });

    // The one required item is answered.
    const responseId = randomUUID();
    await db.execute(sql`
      insert into response (id, item_id, value, status, submitted_at)
      values (${responseId}, ${fixture.itemId}, '"done"'::jsonb, 'submitted', now())
    `);

    const result = await runReminderScan(deps(mail));
    expect(result).toMatchObject({ considered: 1, sent: 0, stopped: 1 });
    expect(mail.sent).toHaveLength(0);

    const { rows } = await db.execute<{ active: boolean }>(sql`
      select active from reminder_schedule where id = ${fixture.scheduleId}
    `);
    expect(rows[0]!.active).toBe(false);

    const { rows: events } = await db.execute<{ action: string; metadata: { reason: string } }>(sql`
      select action, metadata from audit_event where request_id = ${fixture.requestId} order by id desc limit 1
    `);
    expect(events[0]).toMatchObject({
      action: 'reminder.stopped',
      metadata: { reason: 'everything required is in' },
    });
  });

  it('stops when the client has no usable address, rather than retrying forever', async () => {
    const mail = new RecordingMail();
    // `client.email` is NOT NULL, so the reachable version of "no address" is an empty
    // one — what a CSV import of a client list with a missing column leaves behind.
    const fixture = await seed({ email: '   ' });

    const result = await runReminderScan(deps(mail));
    expect(result).toMatchObject({ sent: 0, stopped: 1 });

    const { rows } = await db.execute<{ active: boolean }>(sql`
      select active from reminder_schedule where id = ${fixture.scheduleId}
    `);
    expect(rows[0]!.active).toBe(false);
  });

  it('defers a retryable failure without consuming the reminder', async () => {
    const mail = new RecordingMail();
    mail.failure = new MailError('the SMTP server is down', { retryable: true });
    const fixture = await seed();

    const result = await runReminderScan(deps(mail));
    expect(result).toMatchObject({ sent: 0, failed: 1 });

    const { rows } = await db.execute<{
      sent_count: number;
      active: boolean;
      next_run_at: Date;
    }>(
      sql`select sent_count, active, next_run_at from reminder_schedule where id = ${fixture.scheduleId}`,
    );

    // Still on, still the same reminder, just later — so the retry reuses the same
    // idempotency key rather than becoming the next one in the sequence.
    expect(rows[0]).toMatchObject({ sent_count: 0, active: true });
    expect(new Date(rows[0]!.next_run_at).getTime()).toBeGreaterThan(Date.now());

    const { rows: logs } = await db.execute<{ status: string; error: string }>(sql`
      select status, error from reminder_log where request_id = ${fixture.requestId}
    `);
    expect(logs[0]).toMatchObject({ status: 'deferred', error: 'the SMTP server is down' });
  });

  it('stops on a permanent failure, because it will not fix itself', async () => {
    const mail = new RecordingMail();
    mail.failure = new MailError('that mailbox does not exist', { retryable: false });
    const fixture = await seed();

    await runReminderScan(deps(mail));

    const { rows } = await db.execute<{ active: boolean }>(sql`
      select active from reminder_schedule where id = ${fixture.scheduleId}
    `);
    expect(rows[0]!.active).toBe(false);

    const { rows: logs } = await db.execute<{ status: string }>(sql`
      select status from reminder_log where request_id = ${fixture.requestId}
    `);
    expect(logs[0]!.status).toBe('failed');
  });

  it('leaves a schedule that is not due yet alone', async () => {
    const mail = new RecordingMail();
    const fixture = await seed();
    await db.execute(sql`
      update reminder_schedule set next_run_at = now() + interval '2 days'
       where id = ${fixture.scheduleId}
    `);

    const result = await runReminderScan(deps(mail));
    expect(result.considered).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('ignores requests that are complete, submitted or archived', async () => {
    const mail = new RecordingMail();
    for (const status of ['complete', 'submitted', 'archived', 'draft']) {
      const fixture = await seed();
      await db.execute(sql`update request set status = ${status} where id = ${fixture.requestId}`);
    }

    const result = await runReminderScan(deps(mail));
    expect(result.considered).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('writes the request email first and a reminder after that', async () => {
    const mail = new RecordingMail();
    const fixture = await seed();

    await runReminderScan(deps(mail));
    await db.execute(sql`
      update reminder_schedule set next_run_at = now() - interval '1 minute'
       where id = ${fixture.scheduleId}
    `);
    await runReminderScan(deps(mail));

    expect(mail.sent).toHaveLength(2);
    // Nobody has forgotten anything on the first message.
    expect(mail.sent[0]!.subject).toBe('Delgado & Co: Year-end documents');
    expect(mail.sent[0]!.text).toContain('no account to create');
    // By the second, they have.
    expect(mail.sent[1]!.subject).toBe('One thing left: Year-end documents');
  });

  it('honours the batch ceiling so a backlog cannot become a burst', async () => {
    const mail = new RecordingMail();
    for (let i = 0; i < 4; i += 1) await seed();

    const capped = { ...deps(mail), config: { ...config, GATHER_REMINDER_BATCH: 2 } };
    const result = await runReminderScan(capped);

    expect(result.considered).toBe(2);
    expect(mail.sent).toHaveLength(2);
  });
});
