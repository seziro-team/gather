'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { FIRM_ROLES, Forbidden } from '@gather/core';
import { currentActor } from '@/lib/actor';
import { changeRole, invite, remove, revoke } from '@/lib/team';
import { startCheckout, openBillingPortal } from '@/lib/billing';
import type { BillingRedirect, InviteResult, TeamActionResult } from './results';

/**
 * Everything the settings pages can ask the server to do.
 *
 * Each one resolves the actor first and lets the helper refuse. `Forbidden` carries a
 * message written for the person who hit it — "Only an owner can change the subscription",
 * not "missing permission billing:manage" — so it is surfaced as-is rather than mapped.
 */

const role = z.enum(FIRM_ROLES);

function failure(error: unknown): TeamActionResult {
  if (error instanceof Forbidden) return { ok: false, error: error.message };
  return { ok: false, error: (error as Error).message };
}

export async function inviteMemberAction(email: string, memberRole: string): Promise<InviteResult> {
  const parsed = z
    .object({ email: z.email('Enter a valid email address.'), role })
    .safeParse({ email, role: memberRole });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const actor = await currentActor();
  try {
    const result = await invite(actor, parsed.data);
    revalidatePath('/settings/team');
    return result;
  } catch (error) {
    return failure(error) as InviteResult;
  }
}

export async function revokeInviteAction(inviteId: string): Promise<TeamActionResult> {
  if (!z.uuid().safeParse(inviteId).success) {
    return { ok: false, error: 'That invitation could not be identified.' };
  }
  const actor = await currentActor();
  try {
    await revoke(actor, inviteId);
    revalidatePath('/settings/team');
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function changeRoleAction(
  userId: string,
  memberRole: string,
): Promise<TeamActionResult> {
  const parsed = role.safeParse(memberRole);
  if (!parsed.success) return { ok: false, error: 'That is not a role.' };

  const actor = await currentActor();
  try {
    await changeRole(actor, userId, parsed.data);
    revalidatePath('/settings/team');
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function removeMemberAction(userId: string): Promise<TeamActionResult> {
  const actor = await currentActor();
  try {
    await remove(actor, userId);
    revalidatePath('/settings/team');
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function startCheckoutAction(plan: string): Promise<BillingRedirect> {
  const parsed = z.enum(['cloud', 'cloud_pro']).safeParse(plan);
  if (!parsed.success) return { ok: false, error: 'That is not a plan.' };

  const actor = await currentActor();
  try {
    return await startCheckout(actor, parsed.data);
  } catch (error) {
    return failure(error) as BillingRedirect;
  }
}

export async function openBillingPortalAction(): Promise<BillingRedirect> {
  const actor = await currentActor();
  try {
    return await openBillingPortal(actor);
  } catch (error) {
    return failure(error) as BillingRedirect;
  }
}
