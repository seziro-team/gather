import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listFirms, platformTotals } from './admin.js';
import { createDatabase, createPool, type Database } from './client.js';
import { runMigrations } from './migrator.js';
import {
  acceptInvite,
  applySubscription,
  firmPlanFor,
  inviteMember,
  listMembers,
  listPendingInvites,
  removeMember,
  revokeInvite,
  seatsInUse,
  setMemberRole,
} from './team.js';
import { testDatabaseUrl } from './test-database.js';

/**
 * Firms, the people in them, and what they are paying for — against real Postgres.
 *
 * The point of the file is the boundary. Two firms exist in every test that matters, and
 * the assertions are as much about what firm B *cannot* see as about what firm A gets. A
 * missing `where firm_id = ...` is the failure mode this product cannot have, and it is
 * invisible in a single-tenant test.
 */

let pool: Pool;
let db: Database;

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
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_event`);
  await db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_head`);
});

async function makeUser(label: string): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${id}, ${label}, ${`${label.toLowerCase().replace(/\W+/g, '.')}-${id.slice(0, 8)}@example.test`}, false, now(), now())
  `);
  return id;
}

async function makeFirm(name: string): Promise<{ firmId: string; ownerId: string }> {
  const firmId = randomUUID();
  const ownerId = await makeUser(`Owner of ${name}`);

  await db.execute(sql`
    insert into firm (id, name, slug, brand_color, timezone)
    values (${firmId}, ${name}, ${`f-${firmId.slice(0, 8)}`}, '#0f766e', 'Europe/London')
  `);
  await db.execute(sql`
    insert into firm_user (firm_id, user_id, role) values (${firmId}, ${ownerId}, 'owner')
  `);

  return { firmId, ownerId };
}

describe('invitations', () => {
  it('is accepted once, and the second attempt is refused', async () => {
    const { firmId, ownerId } = await makeFirm('Delgado & Co');
    const joiner = await makeUser('Sam Junior');

    const issued = await db.transaction((tx) =>
      inviteMember(tx, {
        firmId,
        email: 'sam@delgado.example',
        role: 'member',
        invitedBy: ownerId,
        expiresInDays: 14,
      }),
    );

    const first = await db.transaction((tx) => acceptInvite(tx, issued.secret, joiner));
    expect(first).toEqual({ ok: true, firmId, role: 'member' });

    // A second click on the same link — the common case, not an attack — must not produce
    // a second membership or a second audit event.
    const second = await db.transaction((tx) => acceptInvite(tx, issued.secret, joiner));
    expect(second).toEqual({ ok: false, reason: 'accepted' });

    const members = await listMembers(db, firmId);
    expect(members.map((member) => member.userId).sort()).toEqual([joiner, ownerId].sort());
  });

  it('refuses a revoked invitation and an expired one', async () => {
    const { firmId, ownerId } = await makeFirm('Okafor Tax');
    const joiner = await makeUser('Ada Joiner');

    const revoked = await db.transaction((tx) =>
      inviteMember(tx, {
        firmId,
        email: 'ada@okafor.example',
        role: 'member',
        invitedBy: ownerId,
        expiresInDays: 14,
      }),
    );
    await db.transaction((tx) => revokeInvite(tx, firmId, revoked.id, ownerId));
    expect(await db.transaction((tx) => acceptInvite(tx, revoked.secret, joiner))).toEqual({
      ok: false,
      reason: 'revoked',
    });

    const expiring = await db.transaction((tx) =>
      inviteMember(tx, {
        firmId,
        email: 'later@okafor.example',
        role: 'member',
        invitedBy: ownerId,
        expiresInDays: 14,
      }),
    );
    await db.execute(sql`
      update firm_invite set expires_at = now() - interval '1 day' where id = ${expiring.id}
    `);
    expect(await db.transaction((tx) => acceptInvite(tx, expiring.secret, joiner))).toEqual({
      ok: false,
      reason: 'expired',
    });

    expect(await seatsInUse(db, firmId)).toBe(1);
  });

  it('cannot be revoked by another firm', async () => {
    const a = await makeFirm('Firm A');
    const b = await makeFirm('Firm B');

    const issued = await db.transaction((tx) =>
      inviteMember(tx, {
        firmId: a.firmId,
        email: 'target@a.example',
        role: 'member',
        invitedBy: a.ownerId,
        expiresInDays: 14,
      }),
    );

    // Firm B knows the invitation id — say it leaked in a log — and tries to cancel it.
    const revoked = await db.transaction((tx) => revokeInvite(tx, b.firmId, issued.id, b.ownerId));
    expect(revoked).toBe(false);

    // Still usable by the person it was actually for.
    const joiner = await makeUser('Rightful Joiner');
    expect(await db.transaction((tx) => acceptInvite(tx, issued.secret, joiner))).toMatchObject({
      ok: true,
      firmId: a.firmId,
    });
  });

  it('counts a pending invitation as a seat, so a limit cannot be walked past', async () => {
    const { firmId, ownerId } = await makeFirm('Seat Counting LLP');

    await db.transaction((tx) =>
      inviteMember(tx, {
        firmId,
        email: 'pending@seats.example',
        role: 'member',
        invitedBy: ownerId,
        expiresInDays: 14,
      }),
    );

    // One member plus one outstanding invitation. Ignoring the invitation would let a firm
    // on a three-seat plan send thirty invitations and end up with thirty-one people.
    expect(await seatsInUse(db, firmId)).toBe(2);
    expect(await listPendingInvites(db, firmId)).toHaveLength(1);
  });
});

describe('membership', () => {
  it('changes a role and removes a person, both scoped to the firm', async () => {
    const a = await makeFirm('Firm A');
    const b = await makeFirm('Firm B');
    const joiner = await makeUser('Movable Person');

    const issued = await db.transaction((tx) =>
      inviteMember(tx, {
        firmId: a.firmId,
        email: 'movable@a.example',
        role: 'member',
        invitedBy: a.ownerId,
        expiresInDays: 14,
      }),
    );
    await db.transaction((tx) => acceptInvite(tx, issued.secret, joiner));

    await db.transaction((tx) => setMemberRole(tx, a.firmId, joiner, 'admin', a.ownerId));
    expect((await listMembers(db, a.firmId)).find((m) => m.userId === joiner)?.role).toBe('admin');

    // Firm B tries to change and then remove somebody who is not theirs. Both refuse, and
    // — the part that matters — firm A's records are untouched afterwards.
    await expect(
      db.transaction((tx) => setMemberRole(tx, b.firmId, joiner, 'member', b.ownerId)),
    ).rejects.toThrow('not in this firm');
    expect((await listMembers(db, a.firmId)).find((m) => m.userId === joiner)?.role).toBe('admin');

    await expect(
      db.transaction((tx) => removeMember(tx, b.firmId, joiner, b.ownerId)),
    ).rejects.toThrow('not in this firm');
    expect(await listMembers(db, a.firmId)).toHaveLength(2);

    // The firm they are actually in can do both.
    await db.transaction((tx) => removeMember(tx, a.firmId, joiner, a.ownerId));
    expect(await listMembers(db, a.firmId)).toHaveLength(1);
  });

  it('never lists another firm’s people', async () => {
    const a = await makeFirm('Firm A');
    const b = await makeFirm('Firm B');

    expect((await listMembers(db, a.firmId)).map((m) => m.userId)).toEqual([a.ownerId]);
    expect((await listMembers(db, b.firmId)).map((m) => m.userId)).toEqual([b.ownerId]);
  });
});

describe('subscriptions', () => {
  it('defaults to self-hosted with no row at all', async () => {
    const { firmId } = await makeFirm('Unbilled & Co');

    // The important one. No subscription is not "expired" or "free tier" — it is the
    // whole product with no limits, which is what a self-hosted install always is.
    expect(await firmPlanFor(db, firmId)).toMatchObject({
      plan: 'self_hosted',
      effective: 'self_hosted',
      status: 'none',
    });
  });

  it('applies what Stripe said, and a lapsed plan falls back rather than locking up', async () => {
    const { firmId } = await makeFirm('Paying Firm');

    await db.transaction((tx) =>
      applySubscription(tx, {
        firmId,
        plan: 'cloud_pro',
        status: 'active',
        stripeCustomerId: 'cus_test_123',
        stripeSubscriptionId: 'sub_test_123',
        currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
        cancelAtPeriodEnd: false,
        seatLimit: null,
        storageLimitBytes: null,
      }),
    );

    expect(await firmPlanFor(db, firmId)).toMatchObject({
      plan: 'cloud_pro',
      effective: 'cloud_pro',
      status: 'active',
      stripeCustomerId: 'cus_test_123',
    });

    // Upsert, not insert: the second event for the same firm updates the row.
    await db.transaction((tx) =>
      applySubscription(tx, {
        firmId,
        plan: 'cloud_pro',
        status: 'canceled',
        stripeCustomerId: 'cus_test_123',
        stripeSubscriptionId: 'sub_test_123',
        currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
        cancelAtPeriodEnd: true,
        seatLimit: null,
        storageLimitBytes: null,
      }),
    );

    const after = await firmPlanFor(db, firmId);
    expect(after.plan).toBe('cloud_pro');
    expect(after.effective).toBe('self_hosted');

    const [{ total }] = (
      await db.execute<{ total: string }>(
        sql`select count(*)::text as total from subscription where firm_id = ${firmId}`,
      )
    ).rows;
    expect(total).toBe('1');
  });
});

describe('the platform admin view', () => {
  it('is the only thing that sees every firm, and counts each one separately', async () => {
    const a = await makeFirm('Alpha Accounting');
    const b = await makeFirm('Beta Bookkeeping');

    await db.transaction((tx) =>
      applySubscription(tx, {
        firmId: b.firmId,
        plan: 'cloud',
        status: 'active',
        stripeCustomerId: 'cus_beta',
        stripeSubscriptionId: 'sub_beta',
        currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
        cancelAtPeriodEnd: false,
        seatLimit: 3,
        storageLimitBytes: null,
      }),
    );

    const firms = await listFirms(db);
    const alpha = firms.find((firm) => firm.id === a.firmId);
    const beta = firms.find((firm) => firm.id === b.firmId);

    expect(alpha).toMatchObject({ name: 'Alpha Accounting', plan: 'self_hosted', members: 1 });
    expect(beta).toMatchObject({ name: 'Beta Bookkeeping', plan: 'cloud', status: 'active' });
    expect(alpha?.storageBytes).toBe(0);

    // Dates, not the strings a raw query hands back. Typing them as Date is not enough:
    // `db.execute` does no column mapping, so this is the only thing that catches it —
    // and what it caught was the operator console throwing on every page load.
    expect(alpha?.createdAt).toBeInstanceOf(Date);
    expect(alpha?.createdAt.getFullYear()).toBeGreaterThan(2020);
    // Alpha was inserted directly and has no audit events, so it has genuinely never been
    // used; Beta's subscription wrote one, so it has a real timestamp.
    expect(alpha?.lastActivityAt).toBeNull();
    expect(beta?.lastActivityAt).toBeInstanceOf(Date);

    const totals = await platformTotals(db);
    expect(totals.firms).toBeGreaterThanOrEqual(2);
    expect(totals.paying).toBe(1);
    expect(totals.pastDue).toBe(0);
  });
});
