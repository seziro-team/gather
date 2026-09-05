/**
 * What each plan includes.
 *
 * The boundary rule from plan.md §7.2, made structural rather than promised: **every paid
 * item is hosting, a cost we pay per message, a third-party integration, or a compliance
 * convenience. Nothing in the self-hosted product is crippled to create a paid one.**
 *
 * That is why `self_hosted` has `null` for every limit rather than a large number. `null`
 * means "no limit exists", and the gate reads it as unlimited without arithmetic. A firm
 * running Gather on its own server cannot be metered by code that has no meter, which is a
 * stronger guarantee than a generous default somebody could later edit down.
 *
 * Prices are in `plan.md` §7.2 and on the site. They are not here, because a number in two
 * places is a number that will disagree — Stripe is the source of truth for what a customer
 * is charged, and this file is the source of truth for what they get.
 */

export const PLANS = ['self_hosted', 'cloud', 'cloud_pro'] as const;
export type Plan = (typeof PLANS)[number];

/**
 * Things a plan can include.
 *
 * **Only what is built.** SMS reminders, e-signature and cloud-drive sync were in the
 * original plan for this tier and are not in v0.1.0 — each needs a third-party account
 * nobody has yet (a registered 10DLC brand, OAuth apps at three vendors), and shipping
 * integration code that has never once run would be exactly the pretending this product
 * refuses to do elsewhere. They are recorded as deferred in plan.md §7.2 rather than listed
 * here, because this list is what the pricing table is generated from: a feature in this
 * array is a feature somebody is paying for.
 */
export const FEATURES = [
  /** Automatic retention policies rather than running the purge yourself. */
  'managed-retention',
  /** Backups, updates and monitoring done by somebody else. */
  'managed-hosting',
] as const;

export type Feature = (typeof FEATURES)[number];

export interface PlanDefinition {
  key: Plan;
  name: string;
  /** `null` means no limit — not a large one. */
  seats: number | null;
  storageBytes: number | null;
  features: readonly Feature[];
  /** One line, for the upgrade prompt and the pricing table. */
  summary: string;
}

const GB = 1024 * 1024 * 1024;

export const PLAN_DEFINITIONS: Record<Plan, PlanDefinition> = {
  self_hosted: {
    key: 'self_hosted',
    name: 'Self-hosted',
    // Unlimited, and not as a favour: the disk and the seats are the firm's own.
    seats: null,
    storageBytes: null,
    // Everything a firm can run itself is already theirs. What is missing from this list
    // is only what costs us money per use or needs an account we hold.
    features: [],
    summary: 'Everything, on your own server, with no caps. Free forever.',
  },
  cloud: {
    key: 'cloud',
    name: 'Gather Cloud',
    seats: 3,
    storageBytes: 25 * GB,
    features: ['managed-retention', 'managed-hosting'],
    summary: 'The same product, hosted, backed up and updated by us.',
  },
  cloud_pro: {
    key: 'cloud_pro',
    name: 'Gather Cloud Pro',
    seats: 10,
    storageBytes: 100 * GB,
    // Same features as Cloud. What Pro buys is room: more people and more storage. That is
    // a thinner difference than the original plan imagined, and it is the honest one until
    // the integrations above exist.
    features: ['managed-retention', 'managed-hosting'],
    summary: 'Cloud, with room for a bigger practice: ten seats and 100 GB.',
  },
};

export function planIncludes(plan: Plan, feature: Feature): boolean {
  return PLAN_DEFINITIONS[plan].features.includes(feature);
}

export interface UsageCheck {
  allowed: boolean;
  /** `null` when the plan has no limit at all. */
  limit: number | null;
  current: number;
  reason?: string;
}

/**
 * Whether one more seat fits.
 *
 * Counts pending invitations as well as members, because a firm that invites five people
 * onto a three-seat plan should be told when they invite, not when the fifth accepts and
 * somebody else is silently locked out.
 */
export function checkSeats(plan: Plan, membersAndInvites: number): UsageCheck {
  const limit = PLAN_DEFINITIONS[plan].seats;
  if (limit === null) return { allowed: true, limit: null, current: membersAndInvites };

  return {
    allowed: membersAndInvites < limit,
    limit,
    current: membersAndInvites,
    reason:
      membersAndInvites < limit
        ? undefined
        : `${PLAN_DEFINITIONS[plan].name} includes ${limit} seat${limit === 1 ? '' : 's'}, ` +
          `and ${membersAndInvites} are in use or invited.`,
  };
}

/**
 * Whether an upload fits.
 *
 * The limit is on what is *stored*, so a purge frees it — the same rule a disk follows,
 * which is the one a firm already understands.
 */
export function checkStorage(plan: Plan, usedBytes: number, incomingBytes: number): UsageCheck {
  const limit = PLAN_DEFINITIONS[plan].storageBytes;
  if (limit === null) return { allowed: true, limit: null, current: usedBytes };

  const after = usedBytes + incomingBytes;
  return {
    allowed: after <= limit,
    limit,
    current: usedBytes,
    reason:
      after <= limit
        ? undefined
        : `${PLAN_DEFINITIONS[plan].name} includes ${Math.round(limit / GB)} GB, and this ` +
          `file would take you past it.`,
  };
}

/**
 * Which plan a firm is actually on, given what Stripe last told us.
 *
 * A lapsed subscription falls back to `self_hosted` rather than to nothing. On Gather
 * Cloud that means the firm keeps its documents and its account and loses only the hosted
 * extras — because the alternative, locking a firm out of its clients' tax records over a
 * failed card, is not a thing this product will do.
 */
export function effectivePlan(
  plan: Plan,
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled',
): Plan {
  // `past_due` is Stripe still retrying. Nothing changes while a card gets fixed.
  if (status === 'active' || status === 'trialing' || status === 'past_due') return plan;
  return 'self_hosted';
}
