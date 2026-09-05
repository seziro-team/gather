import { checkSeats, env, PLAN_DEFINITIONS, type FirmRole } from '@gather/core';
import {
  acceptInvite,
  findInvite,
  getDb,
  inviteMember,
  listMembers,
  listPendingInvites,
  removeMember,
  revokeInvite,
  seatsInUse,
  setMemberRole,
  type InviteRejection,
  type Member,
} from '@gather/db';
import { getMail, mailConfigured, renderInviteEmail } from '@gather/mail';
import { requirePermission, type Actor } from './actor';
import { currentPlan } from './cloud';
import { logger } from './logger';

/**
 * The people in a firm.
 *
 * Useful to a self-hosted firm with two staff and to a cloud firm with ten, which is why
 * it is in the product rather than in a `cloud/` directory. What the cloud tier adds is a
 * seat limit; self-hosted has none, and `checkSeats` returns `allowed: true` without
 * arithmetic when the limit is `null`.
 */

export interface TeamView {
  members: Member[];
  invites: { id: string; email: string; role: FirmRole; expiresAt: string }[];
  seatsUsed: number;
  seatLimit: number | null;
  canInvite: boolean;
  /** Why not, when `canInvite` is false and it is not a permission problem. */
  seatReason?: string;
  mailConfigured: boolean;
}

export async function readTeam(firmId: string): Promise<TeamView> {
  const db = getDb();
  const [members, invites, seatsUsed, plan] = await Promise.all([
    listMembers(db, firmId),
    listPendingInvites(db, firmId),
    seatsInUse(db, firmId),
    currentPlan(firmId),
  ]);

  const seats = checkSeats(plan, seatsUsed);

  return {
    members,
    invites: invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    })),
    seatsUsed,
    seatLimit: PLAN_DEFINITIONS[plan].seats,
    canInvite: seats.allowed,
    seatReason: seats.reason,
    mailConfigured: mailConfigured(),
  };
}

export type InviteResult =
  { ok: true; url: string; emailed: boolean } | { ok: false; error: string };

/**
 * Invite somebody, and email them the link.
 *
 * The link is also returned, because an install with no mail configured still has to be
 * able to add a colleague — the firm copies it and sends it however they already talk.
 * Same reasoning as the portal link in Phase 3.
 */
export async function invite(
  actor: Actor,
  input: { email: string; role: FirmRole },
): Promise<InviteResult> {
  requirePermission(actor, 'team:manage');
  if (input.role === 'owner') requirePermission(actor, 'team:manage-owners');

  const plan = await currentPlan(actor.firmId);
  const seats = checkSeats(plan, await seatsInUse(getDb(), actor.firmId));
  if (!seats.allowed) {
    return { ok: false, error: seats.reason ?? 'This plan has no seats left.' };
  }

  let issued;
  try {
    issued = await getDb().transaction((tx) =>
      inviteMember(tx, {
        firmId: actor.firmId,
        email: input.email,
        role: input.role,
        invitedBy: actor.actorId,
        expiresInDays: 14,
        ip: actor.context.ip,
        ua: actor.context.ua,
      }),
    );
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const url = new URL(`/join/${issued.secret}`, env().GATHER_APP_URL).toString();

  let emailed = false;
  if (mailConfigured()) {
    try {
      const email = renderInviteEmail({
        firmName: actor.firmName,
        invitedBy: actor.actorName,
        role: input.role,
        url,
        expiresAt: issued.expiresAt,
      });
      await getMail().send({
        to: input.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      emailed = true;
    } catch (error) {
      // Not fatal: the invitation exists and the link is on screen. Telling somebody their
      // colleague was not invited because an SMTP server was slow would be wrong.
      logger.warn('could not email an invitation', { error: (error as Error).message });
    }
  }

  return { ok: true, url, emailed };
}

export async function revoke(actor: Actor, inviteId: string): Promise<void> {
  requirePermission(actor, 'team:manage');
  await getDb().transaction(async (tx) => {
    const revoked = await revokeInvite(tx, actor.firmId, inviteId, actor.actorId);
    if (!revoked) throw new Error('That invitation has already been used or revoked.');
  });
}

export async function changeRole(actor: Actor, userId: string, role: FirmRole): Promise<void> {
  requirePermission(actor, 'team:manage');

  const members = await listMembers(getDb(), actor.firmId);
  const subject = members.find((member) => member.userId === userId);
  if (!subject) throw new Error('That person is not in this firm.');

  // Promoting to owner, or touching an existing owner, is an owner's decision — otherwise
  // an admin could demote the owner and take the firm.
  if (role === 'owner' || subject.role === 'owner') {
    requirePermission(actor, 'team:manage-owners');
  }

  await getDb().transaction((tx) => setMemberRole(tx, actor.firmId, userId, role, actor.actorId));
}

export async function remove(actor: Actor, userId: string): Promise<void> {
  requirePermission(actor, 'team:manage');

  const members = await listMembers(getDb(), actor.firmId);
  const subject = members.find((member) => member.userId === userId);
  if (!subject) throw new Error('That person is not in this firm.');
  if (subject.role === 'owner') requirePermission(actor, 'team:manage-owners');

  await getDb().transaction((tx) => removeMember(tx, actor.firmId, userId, actor.actorId));
}

export async function lookupInvite(secret: string) {
  return findInvite(getDb(), secret);
}

export async function join(
  secret: string,
  userId: string,
  context: { ip: string | null; ua: string | null },
): Promise<{ ok: true; firmId: string } | { ok: false; reason: InviteRejection }> {
  const result = await getDb().transaction((tx) => acceptInvite(tx, secret, userId, context));
  return result.ok ? { ok: true, firmId: result.firmId } : result;
}
