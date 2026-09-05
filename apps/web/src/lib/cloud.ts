import {
  assertCan,
  effectivePlan,
  env,
  matchesAdminList,
  type Permission,
  type Plan,
} from '@gather/core';
import { checkStorage, PLAN_DEFINITIONS } from '@gather/core';
import { firmPlanFor, getDb, seatsInUse, storageUsed, type FirmPlan } from '@gather/db';
import { billingEnabled } from '@gather/billing';
import type { Membership } from './firm';

/**
 * The hosted tier, from the app's side.
 *
 * The important property, and the one every function here preserves: **an install with no
 * billing configured behaves exactly as it did before Phase 7.** `cloudEnabled()` is false,
 * every firm is `self_hosted`, every limit is `null`, and the gate functions return
 * "allowed" without consulting anything. Gather Cloud is hosting and convenience; it does
 * not unlock the core, and that has to be true in the code rather than in a README.
 */

export function cloudEnabled(): boolean {
  return env().GATHER_CLOUD && billingEnabled();
}

/** Whoever runs the hosted tier. Empty on a self-hosted install, which is the point. */
export function isPlatformAdmin(email: string): boolean {
  return matchesAdminList(email, env().GATHER_ADMIN_EMAILS);
}

/**
 * What a firm on the hosted tier gets before — or after — a subscription.
 *
 * The entry plan's limits, and nothing worse. A firm is **never** locked out of documents it
 * has already collected: no read-only mode, no "your data is held hostage until you pay"
 * screen. If somebody stops paying for Gather Cloud, the way out is the self-hosted product
 * and an export, and that has to stay true or the open-source promise is decoration.
 *
 * On a self-hosted install this is never consulted — `firmPlanFor` returns `self_hosted`,
 * whose limits are `null`, and no code path here runs at all.
 */
const CLOUD_ENTRY_PLAN = 'cloud' satisfies Plan;

/**
 * The plan a firm's limits actually come from, on this install.
 *
 * One function so the billing page, the seat check and the operator console cannot disagree
 * about what a firm is on — which they did, briefly, and the console was the one telling the
 * truth about the database rather than about the product.
 */
export function applicablePlan(effective: Plan): Plan {
  if (!cloudEnabled()) return 'self_hosted';
  return effective === 'self_hosted' ? CLOUD_ENTRY_PLAN : effective;
}

export interface PlanContext extends FirmPlan {
  seatsUsed: number;
  storageUsedBytes: number;
  /** False on a self-hosted install: there is nothing to show and nothing to buy. */
  billing: boolean;
}

export async function planContext(firmId: string): Promise<PlanContext> {
  const db = getDb();

  if (!cloudEnabled()) {
    return {
      plan: 'self_hosted',
      effective: 'self_hosted',
      status: 'none',
      stripeCustomerId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      seatsUsed: await seatsInUse(db, firmId),
      storageUsedBytes: 0,
      billing: false,
    };
  }

  const [plan, seats, storage] = await Promise.all([
    firmPlanFor(db, firmId),
    seatsInUse(db, firmId),
    storageUsed(db, firmId),
  ]);

  return {
    ...plan,
    effective: applicablePlan(plan.effective),
    seatsUsed: seats,
    storageUsedBytes: storage,
    billing: true,
  };
}

/**
 * The plan whose limits apply to this firm right now.
 *
 * Self-hosted is unconditional and unmetered. On the hosted tier, a firm with no live
 * subscription — one still deciding, or one that has stopped paying — lands on the entry
 * plan's limits rather than on nothing, because "nothing" would mean either unlimited
 * (giving the hosted product away) or locked out (holding a firm's documents hostage).
 */
export async function currentPlan(firmId: string): Promise<Plan> {
  if (!cloudEnabled()) return 'self_hosted';
  const plan = await firmPlanFor(getDb(), firmId);
  return applicablePlan(effectivePlan(plan.plan, plan.status));
}

/**
 * Whether to *show* a control.
 *
 * The refusal itself lives in `requirePermission` in actor.ts, applied inside the helper
 * that performs the mutation. This is only for hiding a button somebody cannot use — a
 * disabled button and a 403 are different messages, and the second one is what actually
 * protects anything.
 */
export function actorCan(membership: Membership, permission: Permission): boolean {
  try {
    assertCan(membership.role, permission);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether one more upload fits inside the firm's plan.
 *
 * **Returns immediately on a self-hosted install** — before any query. The limit is `null`,
 * so there is nothing to compare against and no reason to make a firm's own server count
 * its own bytes on every upload.
 *
 * Called from the portal upload route with the declared length, which is a claim, so it is a
 * pre-check rather than the enforcement: the streaming limit in @gather/storage is what
 * actually stops a lying client. This is what tells a client *why*, before they wait for a
 * 40 MB upload to be refused at the end of it.
 */
export async function checkUploadFits(
  firmId: string,
  incomingBytes: number,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!cloudEnabled()) return { allowed: true };

  const plan = await currentPlan(firmId);
  if (PLAN_DEFINITIONS[plan].storageBytes === null) return { allowed: true };

  const result = checkStorage(plan, await storageUsed(getDb(), firmId), incomingBytes);
  if (result.allowed) return { allowed: true };

  // Written for the client, who did not choose this plan and cannot fix it: tell them who
  // can. Naming the accountant's firm is the point — "storage limit exceeded" would leave
  // somebody with a tax deadline staring at a machine.
  return {
    allowed: false,
    reason:
      'There is no room left in your accountant’s account for this file. Nothing you have ' +
      'already sent is affected — let them know, and they can make room.',
  };
}
