import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { effectivePlan, type FirmRole, type Plan } from '@gather/core';
import { appendAuditEvent } from './audit.js';
import type { Database, DbTransaction } from './client.js';
import { firm, firmInvite, firmUser, subscription } from './schema/gather.js';
import { user } from './schema/auth.js';

/**
 * The people in a firm, and what the firm is paying for.
 *
 * Invitations are shaped exactly like portal links, and for the same reasons: 32 bytes of
 * CSPRNG stored only as SHA-256, per-invite expiry, revocable, and every use recorded. The
 * only difference is what accepting one does — join a firm rather than open one request.
 */

type Db = Database | DbTransaction;

const TOKEN_BYTES = 32;

export type InviteRow = typeof firmInvite.$inferSelect;
export type SubscriptionRow = typeof subscription.$inferSelect;

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: FirmRole;
  joinedAt: Date;
  twoFactorEnabled: boolean;
}

export async function listMembers(db: Db, firmId: string): Promise<Member[]> {
  return db
    .select({
      userId: firmUser.userId,
      name: user.name,
      email: user.email,
      role: firmUser.role,
      joinedAt: firmUser.createdAt,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(firmUser)
    .innerJoin(user, eq(user.id, firmUser.userId))
    .where(eq(firmUser.firmId, firmId))
    .orderBy(asc(firmUser.createdAt));
}

export async function listPendingInvites(db: Db, firmId: string): Promise<InviteRow[]> {
  return db
    .select()
    .from(firmInvite)
    .where(
      and(
        eq(firmInvite.firmId, firmId),
        isNull(firmInvite.acceptedAt),
        isNull(firmInvite.revokedAt),
      ),
    )
    .orderBy(asc(firmInvite.createdAt));
}

/**
 * Seats in use.
 *
 * Members **plus** live invitations, so a firm on a three-seat plan is told when they
 * invite the fourth person rather than when that person tries to accept and finds the
 * door shut.
 */
export async function seatsInUse(db: Db, firmId: string): Promise<number> {
  const [members] = await db
    .select({ total: count() })
    .from(firmUser)
    .where(eq(firmUser.firmId, firmId));

  const [invites] = await db
    .select({ total: count() })
    .from(firmInvite)
    .where(
      and(
        eq(firmInvite.firmId, firmId),
        isNull(firmInvite.acceptedAt),
        isNull(firmInvite.revokedAt),
        gt(firmInvite.expiresAt, new Date()),
      ),
    );

  return (members?.total ?? 0) + (invites?.total ?? 0);
}

export interface IssuedInvite {
  id: string;
  /** Shown once. Only the SHA-256 is stored, so it genuinely cannot be shown again. */
  secret: string;
  expiresAt: Date;
}

export async function inviteMember(
  tx: DbTransaction,
  input: {
    firmId: string;
    email: string;
    role: FirmRole;
    invitedBy: string;
    expiresInDays: number;
    ip?: string | null;
    ua?: string | null;
  },
): Promise<IssuedInvite> {
  const email = input.email.trim().toLowerCase();
  const secret = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);

  // Already in the firm? Re-inviting them would create a second membership.
  const existing = await tx
    .select({ id: firmUser.id })
    .from(firmUser)
    .innerJoin(user, eq(user.id, firmUser.userId))
    .where(and(eq(firmUser.firmId, input.firmId), eq(user.email, email)))
    .limit(1);
  if (existing.length > 0) throw new Error('That person is already in this firm.');

  // A second invitation to the same address replaces the first rather than stacking, which
  // is what the partial unique index enforces and what somebody clicking "invite" twice
  // means.
  await tx
    .update(firmInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(firmInvite.firmId, input.firmId),
        eq(firmInvite.email, email),
        isNull(firmInvite.acceptedAt),
        isNull(firmInvite.revokedAt),
      ),
    );

  const [row] = await tx
    .insert(firmInvite)
    .values({
      firmId: input.firmId,
      email,
      role: input.role,
      tokenHash: hash(secret),
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .returning();

  await appendAuditEvent(tx, {
    action: 'firm.member_invited',
    actorType: 'user',
    actorId: input.invitedBy,
    firmId: input.firmId,
    targetType: 'firm_invite',
    targetId: row!.id,
    metadata: { email, role: input.role, expiresAt: expiresAt.toISOString() },
    ip: input.ip ?? null,
    ua: input.ua ?? null,
  });

  return { id: row!.id, secret, expiresAt };
}

export type InviteRejection = 'unknown' | 'revoked' | 'expired' | 'accepted';

export type InviteLookup =
  { ok: true; invite: InviteRow; firmName: string } | { ok: false; reason: InviteRejection };

/** Resolve an invitation without accepting it, so the page can say who invited whom. */
export async function findInvite(db: Db, secret: string): Promise<InviteLookup> {
  const rows = await db
    .select({ invite: firmInvite, firmName: firm.name })
    .from(firmInvite)
    .innerJoin(firm, eq(firm.id, firmInvite.firmId))
    .where(eq(firmInvite.tokenHash, hash(secret)))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.invite.acceptedAt) return { ok: false, reason: 'accepted' };
  if (row.invite.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.invite.expiresAt <= new Date()) return { ok: false, reason: 'expired' };

  return { ok: true, invite: row.invite, firmName: row.firmName };
}

/**
 * Accept an invitation.
 *
 * The whole thing is one transaction with a conditional update: marking the invite
 * accepted only succeeds if it is still pending, so two clicks on the same link cannot
 * produce two memberships. The membership insert then cannot run without it.
 */
export async function acceptInvite(
  tx: DbTransaction,
  secret: string,
  userId: string,
  context?: { ip?: string | null; ua?: string | null },
): Promise<{ ok: true; firmId: string; role: FirmRole } | { ok: false; reason: InviteRejection }> {
  const found = await findInvite(tx, secret);
  if (!found.ok) return found;

  const [claimed] = await tx
    .update(firmInvite)
    .set({ acceptedAt: new Date(), acceptedBy: userId })
    .where(
      and(
        eq(firmInvite.id, found.invite.id),
        isNull(firmInvite.acceptedAt),
        isNull(firmInvite.revokedAt),
      ),
    )
    .returning();

  if (!claimed) return { ok: false, reason: 'accepted' };

  await tx
    .insert(firmUser)
    .values({ firmId: claimed.firmId, userId, role: claimed.role })
    .onConflictDoNothing();

  await appendAuditEvent(tx, {
    action: 'firm.member_added',
    actorType: 'user',
    actorId: userId,
    firmId: claimed.firmId,
    targetType: 'user',
    targetId: userId,
    metadata: { role: claimed.role, viaInvite: claimed.id },
    ip: context?.ip ?? null,
    ua: context?.ua ?? null,
  });

  return { ok: true, firmId: claimed.firmId, role: claimed.role };
}

export async function revokeInvite(
  tx: DbTransaction,
  firmId: string,
  inviteId: string,
  actorId: string,
): Promise<boolean> {
  const [revoked] = await tx
    .update(firmInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(firmInvite.id, inviteId),
        eq(firmInvite.firmId, firmId),
        isNull(firmInvite.acceptedAt),
        isNull(firmInvite.revokedAt),
      ),
    )
    .returning({ id: firmInvite.id, email: firmInvite.email });

  if (!revoked) return false;

  await appendAuditEvent(tx, {
    action: 'firm.invite_revoked',
    actorType: 'user',
    actorId,
    firmId,
    targetType: 'firm_invite',
    targetId: revoked.id,
    metadata: { email: revoked.email },
  });

  return true;
}

/**
 * Change somebody's role, or remove them.
 *
 * Both refuse to remove the last owner. A firm with no owner has nobody who can manage
 * billing or promote a replacement — it is a locked door with the key inside, and no
 * confirmation dialog makes that recoverable.
 */
export async function setMemberRole(
  tx: DbTransaction,
  firmId: string,
  userId: string,
  role: FirmRole,
  actorId: string,
): Promise<void> {
  if (role !== 'owner' && (await isLastOwner(tx, firmId, userId))) {
    throw new Error(
      'That is the firm’s only owner. Make somebody else an owner first, or the firm would ' +
        'have nobody who can manage billing or add one back.',
    );
  }

  const [updated] = await tx
    .update(firmUser)
    .set({ role })
    .where(and(eq(firmUser.firmId, firmId), eq(firmUser.userId, userId)))
    .returning({ id: firmUser.id });
  if (!updated) throw new Error('That person is not in this firm.');

  await appendAuditEvent(tx, {
    action: 'firm.member_role_changed',
    actorType: 'user',
    actorId,
    firmId,
    targetType: 'user',
    targetId: userId,
    metadata: { role },
  });
}

export async function removeMember(
  tx: DbTransaction,
  firmId: string,
  userId: string,
  actorId: string,
): Promise<void> {
  if (await isLastOwner(tx, firmId, userId)) {
    throw new Error('That is the firm’s only owner. Make somebody else an owner first.');
  }

  const [removed] = await tx
    .delete(firmUser)
    .where(and(eq(firmUser.firmId, firmId), eq(firmUser.userId, userId)))
    .returning({ id: firmUser.id });
  if (!removed) throw new Error('That person is not in this firm.');

  await appendAuditEvent(tx, {
    action: 'firm.member_removed',
    actorType: 'user',
    actorId,
    firmId,
    targetType: 'user',
    targetId: userId,
    metadata: {},
  });
}

async function isLastOwner(db: Db, firmId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: firmUser.role })
    .from(firmUser)
    .where(and(eq(firmUser.firmId, firmId), eq(firmUser.userId, userId)))
    .limit(1);
  if (row?.role !== 'owner') return false;

  const [owners] = await db
    .select({ total: count() })
    .from(firmUser)
    .where(and(eq(firmUser.firmId, firmId), eq(firmUser.role, 'owner')));

  return (owners?.total ?? 0) <= 1;
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export interface FirmPlan {
  /** What they subscribed to. */
  plan: Plan;
  /** What applies right now, after status. A lapsed subscription is `self_hosted`. */
  effective: Plan;
  status: SubscriptionRow['status'];
  stripeCustomerId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const SELF_HOSTED: FirmPlan = {
  plan: 'self_hosted',
  effective: 'self_hosted',
  status: 'none',
  stripeCustomerId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

/**
 * A firm's plan.
 *
 * **No row means self-hosted, which has no limits** — not "unpaid", not "expired". Every
 * install that is not the hosted tier lands here, and the absence of billing must never
 * read as a restriction.
 */
export async function firmPlanFor(db: Db, firmId: string): Promise<FirmPlan> {
  const rows = await db.select().from(subscription).where(eq(subscription.firmId, firmId)).limit(1);

  const row = rows[0];
  if (!row) return SELF_HOSTED;

  return {
    plan: row.plan,
    effective: effectivePlan(row.plan, row.status),
    status: row.status,
    stripeCustomerId: row.stripeCustomerId,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

export interface SubscriptionUpdate {
  firmId: string;
  plan: Plan;
  status: SubscriptionRow['status'];
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  seatLimit: number | null;
  storageLimitBytes: number | null;
}

/**
 * Write what Stripe told us.
 *
 * Called only from the webhook handler. Nothing reachable from a browser writes here — a
 * client that fakes the return from Checkout must not be able to grant itself a plan.
 */
export async function applySubscription(
  tx: DbTransaction,
  update: SubscriptionUpdate,
): Promise<void> {
  await tx
    .insert(subscription)
    .values({ ...update, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: subscription.firmId,
      set: {
        plan: update.plan,
        status: update.status,
        stripeCustomerId: update.stripeCustomerId,
        stripeSubscriptionId: update.stripeSubscriptionId,
        currentPeriodEnd: update.currentPeriodEnd,
        cancelAtPeriodEnd: update.cancelAtPeriodEnd,
        seatLimit: update.seatLimit,
        storageLimitBytes: update.storageLimitBytes,
        updatedAt: new Date(),
      },
    });

  await appendAuditEvent(tx, {
    action: 'billing.subscription_updated',
    actorType: 'system',
    firmId: update.firmId,
    targetType: 'subscription',
    targetId: update.firmId,
    metadata: {
      plan: update.plan,
      status: update.status,
      cancelAtPeriodEnd: update.cancelAtPeriodEnd,
      currentPeriodEnd: update.currentPeriodEnd?.toISOString() ?? null,
    },
  });
}

/** Bytes a firm is storing right now, for the storage limit. Purged files do not count. */
export async function storageUsed(db: Db, firmId: string): Promise<number> {
  const [row] = await db
    .execute<{ total: string }>(
      sql`
    select coalesce(sum(f.size), 0)::text as total
      from file f
      join response r on r.id = f.response_id
      join item i on i.id = r.item_id
      join section s on s.id = i.section_id
      join request req on req.id = s.request_id
     where req.firm_id = ${firmId} and f.purged_at is null
  `,
    )
    .then((result) => result.rows);

  return Number(row?.total ?? 0);
}

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time compare, for anywhere a caller holds two secrets rather than a hash. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The firm to put a new SSO user in, or `null`.
 *
 * `null` unless there is **exactly one** firm on this install. That is the whole safety
 * property: on an install with two firms there is no right answer to "which one", and
 * guessing would drop somebody into another firm's client list. Reads two rows, not all of
 * them — the question is "is there exactly one", not "how many".
 */
export async function soleFirmId(db: Db): Promise<string | null> {
  const rows = await db.select({ id: firm.id }).from(firm).limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}

/** Put a user in a firm, idempotently, with the audit row that says how they got there. */
export async function joinFirm(
  tx: DbTransaction,
  input: { firmId: string; userId: string; role: FirmRole; via: string },
): Promise<void> {
  await tx
    .insert(firmUser)
    .values({ firmId: input.firmId, userId: input.userId, role: input.role })
    .onConflictDoNothing();

  await appendAuditEvent(tx, {
    action: 'firm.member_added',
    actorType: 'system',
    actorId: input.userId,
    firmId: input.firmId,
    targetType: 'user',
    targetId: input.userId,
    metadata: { role: input.role, via: input.via },
  });
}
