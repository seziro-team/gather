import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, createPool, type Database } from './client.js';
import { runMigrations } from './migrator.js';
import { firmTotals, listRequestSummaries, percentComplete } from './review.js';
import { testDatabaseUrl } from './test-database.js';

/**
 * The dashboard's one query.
 *
 * Written after it took the dashboard down. `listRequestSummaries` computes two timestamps
 * with `min(...)` and `max(...)`, which drizzle types as `Date` and node-postgres returns as
 * a **string** — so every caller typechecked perfectly and threw `getTime is not a function`
 * the moment a client submitted anything. It was invisible until then because with no
 * responses in the table the aggregate is null, and null has no methods to get wrong.
 *
 * Hence the shape of this file: it asserts on the *runtime type* of every date the query
 * returns, not only on the numbers. Three separate bugs in this codebase have now been the
 * same mistake, and a type annotation is not what catches it.
 */

let pool: Pool;
let db: Database;
let firmId: string;
let clientId: string;

beforeAll(async () => {
  pool = createPool(await testDatabaseUrl(), { max: 6 });
  db = createDatabase(pool);
  await runMigrations(pool, db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`delete from firm`);
  await db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_event`);
  await db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_head`);

  firmId = randomUUID();
  clientId = randomUUID();
  await db.execute(sql`
    insert into firm (id, name, slug, brand_color, timezone)
    values (${firmId}, 'Delgado & Co', ${`d-${firmId.slice(0, 8)}`}, '#0f766e', 'Europe/London')
  `);
  await db.execute(sql`
    insert into client (id, firm_id, name, email)
    values (${clientId}, ${firmId}, 'Rivera Landscaping', 'rivera@example.test')
  `);
});

/**
 * A request with one section, one required item, and a response in `status`.
 *
 * Built with raw inserts rather than through the app so the test states exactly the row
 * shape it depends on — and so a change to the writing path cannot quietly make it pass.
 */
async function seedRequest(options: {
  title: string;
  status: string;
  responseStatus?: string;
  dueAt?: string;
}): Promise<string> {
  const requestId = randomUUID();
  const sectionId = randomUUID();
  const itemId = randomUUID();

  await db.execute(sql`
    insert into request (id, firm_id, client_id, title, status, due_at, sent_at)
    values (${requestId}, ${firmId}, ${clientId}, ${options.title}, ${options.status},
            ${options.dueAt ?? null}, now() - interval '3 days')
  `);
  await db.execute(sql`
    insert into section (id, request_id, title, position)
    values (${sectionId}, ${requestId}, 'Income', 0)
  `);
  await db.execute(sql`
    insert into item (id, section_id, type, label, required, position, config)
    values (${itemId}, ${sectionId}, 'file', 'Form W-2', true, 0, '{}'::jsonb)
  `);

  if (options.responseStatus) {
    await db.execute(sql`
      insert into response (id, item_id, status, version, updated_at)
      values (${randomUUID()}, ${itemId}, ${options.responseStatus}, 1,
              now() - interval '2 days')
    `);
  }

  return requestId;
}

describe('the dashboard query', () => {
  it('returns Dates for every date, including the aggregates', async () => {
    // A submitted response is what makes `min(response.updated_at)` non-null — which is
    // exactly the state that used to 500 the dashboard.
    await seedRequest({
      title: 'Waiting on the firm',
      status: 'submitted',
      responseStatus: 'submitted',
    });

    const [summary] = await listRequestSummaries(db, firmId);
    expect(summary).toBeDefined();

    expect(summary!.sentAt).toBeInstanceOf(Date);
    expect(summary!.updatedAt).toBeInstanceOf(Date);
    // The two that were strings. `toBeInstanceOf` rather than `not.toBeNull()`: a string
    // passes every null check and fails on the first method call.
    expect(summary!.oldestOutstandingAt).toBeInstanceOf(Date);
    expect(summary!.lastReminderAt).toBeNull();

    // And it is the right instant, not merely a Date. A parser that silently produced
    // Invalid Date would satisfy the assertion above and nothing else.
    const age = Date.now() - summary!.oldestOutstandingAt!.getTime();
    expect(age).toBeGreaterThan(36 * 60 * 60 * 1000);
    expect(age).toBeLessThan(60 * 60 * 60 * 1000);
  });

  it('leaves the aggregates null when there is nothing to aggregate', async () => {
    // The state the bug hid behind for months of development: no responses, so `min(...)`
    // is null and nothing ever calls a method on it.
    await seedRequest({ title: 'Not sent yet', status: 'draft' });

    const [summary] = await listRequestSummaries(db, firmId);
    expect(summary!.oldestOutstandingAt).toBeNull();
    expect(summary!.lastReminderAt).toBeNull();
  });

  it('picks up a reminder’s send time as a Date', async () => {
    const requestId = await seedRequest({
      title: 'Chased twice',
      status: 'in_progress',
      responseStatus: 'pending',
    });
    await db.execute(sql`
      insert into reminder_log
        (id, request_id, channel, to_address, status, sent_at, idempotency_key)
      values (${randomUUID()}, ${requestId}, 'email', 'rivera@example.test', 'sent',
              now() - interval '1 day', ${`manual:${requestId}`})
    `);

    const [summary] = await listRequestSummaries(db, firmId);
    expect(summary!.lastReminderAt).toBeInstanceOf(Date);
    expect(Number.isNaN(summary!.lastReminderAt!.getTime())).toBe(false);
  });

  it('counts what each filter says it counts, and never another firm’s requests', async () => {
    await seedRequest({ title: 'Open one', status: 'in_progress', responseStatus: 'pending' });
    await seedRequest({
      title: 'Waiting on you',
      status: 'submitted',
      responseStatus: 'submitted',
    });
    await seedRequest({ title: 'Finished', status: 'complete', responseStatus: 'approved' });
    await seedRequest({
      title: 'Late',
      status: 'sent',
      responseStatus: 'pending',
      dueAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const otherFirm = randomUUID();
    await db.execute(sql`
      insert into firm (id, name, slug, brand_color, timezone)
      values (${otherFirm}, 'Somebody Else', ${`o-${otherFirm.slice(0, 8)}`}, '#0f766e', 'UTC')
    `);
    expect(await listRequestSummaries(db, otherFirm)).toHaveLength(0);

    expect((await listRequestSummaries(db, firmId, 'needs-review')).map((r) => r.title)).toEqual([
      'Waiting on you',
    ]);
    expect((await listRequestSummaries(db, firmId, 'overdue')).map((r) => r.title)).toEqual([
      'Late',
    ]);
    expect((await listRequestSummaries(db, firmId, 'complete')).map((r) => r.title)).toEqual([
      'Finished',
    ]);
    expect(await listRequestSummaries(db, firmId, 'open')).toHaveLength(3);

    expect(await firmTotals(db, firmId)).toEqual({
      open: 3,
      needsReview: 1,
      overdue: 1,
      complete: 1,
    });
  });

  it('reports progress as a share of every item, not only the required ones', async () => {
    await seedRequest({ title: 'Half done', status: 'in_progress', responseStatus: 'approved' });
    const [summary] = await listRequestSummaries(db, firmId);

    expect(summary!.totalItems).toBe(1);
    expect(summary!.approvedItems).toBe(1);
    expect(percentComplete(summary!)).toBe(100);
  });
});
