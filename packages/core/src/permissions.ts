/**
 * Who may do what.
 *
 * Roles have been in the schema since Phase 1 and enforced nowhere, which is worse than
 * not having them: an interface that shows a "member" badge while letting that member
 * delete the firm is lying to the person reading it.
 *
 * Three roles, because a small firm has three kinds of person and no more:
 *
 *  - **owner** — the partner whose name is on the door. Billing, the firm's own settings,
 *    and the ability to make somebody else an owner.
 *  - **admin** — the person who actually runs the practice's paperwork. Everything about
 *    clients and requests, plus inviting staff. Not billing.
 *  - **member** — staff who collect and review documents. No settings, no team, no billing.
 *
 * Every permission is deliberately about a *capability*, not a route. "Can this person
 * remove a colleague" survives a redesign; "can this person see /settings/team" does not.
 */

export const FIRM_ROLES = ['owner', 'admin', 'member'] as const;
export type FirmRole = (typeof FIRM_ROLES)[number];

export const PERMISSIONS = [
  /** Add, edit and archive clients. */
  'clients:write',
  /** Create, edit and delete requests; issue and revoke portal links. */
  'requests:write',
  /** Approve and reject items, and mark a request complete. */
  'requests:review',
  /** Download files and export the audit trail. */
  'files:read',
  /** Save and delete the firm's own templates. */
  'templates:write',
  /** Turn reminders on, edit a cadence, send a manual nudge. */
  'reminders:manage',
  /** Invite colleagues, change their role, remove them. */
  'team:manage',
  /** Promote somebody to owner, or remove an owner. */
  'team:manage-owners',
  /** The firm's name, colour, logo, timezone and retention policy. */
  'firm:settings',
  /** Subscription, payment method, invoices. */
  'billing:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MEMBER: readonly Permission[] = [
  'clients:write',
  'requests:write',
  'requests:review',
  'files:read',
  'templates:write',
  'reminders:manage',
];

const ADMIN: readonly Permission[] = [...MEMBER, 'team:manage', 'firm:settings'];

const OWNER: readonly Permission[] = [...ADMIN, 'team:manage-owners', 'billing:manage'];

const BY_ROLE: Record<FirmRole, readonly Permission[]> = {
  member: MEMBER,
  admin: ADMIN,
  owner: OWNER,
};

export function can(role: FirmRole, permission: Permission): boolean {
  return BY_ROLE[role].includes(permission);
}

export function permissionsFor(role: FirmRole): readonly Permission[] {
  return BY_ROLE[role];
}

export class Forbidden extends Error {
  constructor(
    readonly permission: Permission,
    readonly role: FirmRole,
  ) {
    super(DENIALS[permission]);
    this.name = 'Forbidden';
  }
}

/**
 * What to tell somebody who cannot do a thing.
 *
 * Written as an explanation rather than a refusal: a colleague who cannot invite people
 * needs to know who can, not that they lack `team:manage`.
 */
const DENIALS: Record<Permission, string> = {
  'clients:write': 'You do not have permission to change clients.',
  'requests:write': 'You do not have permission to change requests.',
  'requests:review': 'You do not have permission to approve or reject items.',
  'files:read': 'You do not have permission to download files.',
  'templates:write': 'You do not have permission to change templates.',
  'reminders:manage': 'You do not have permission to change reminders.',
  'team:manage': 'Only an owner or an admin can manage the team. Ask one of them.',
  'team:manage-owners': 'Only an owner can add or remove another owner.',
  'firm:settings': 'Only an owner or an admin can change the firm’s settings.',
  'billing:manage': 'Only an owner can change the subscription.',
};

export function assertCan(role: FirmRole, permission: Permission): void {
  if (!can(role, permission)) throw new Forbidden(permission, role);
}

/**
 * Whether `actor` may set somebody's role to `target`.
 *
 * Two rules that are easy to get wrong and expensive to get wrong. Making somebody an
 * owner is an owner's decision, so an admin cannot promote themselves past their own
 * ceiling. And nobody may change the role of somebody above them, so an admin cannot
 * demote an owner and take the firm.
 */
export function canAssignRole(
  actorRole: FirmRole,
  subjectRole: FirmRole,
  nextRole: FirmRole,
): boolean {
  if (!can(actorRole, 'team:manage')) return false;

  const rank = { member: 0, admin: 1, owner: 2 } as const;
  if (rank[subjectRole] > rank[actorRole]) return false;
  if (rank[nextRole] > rank[actorRole]) return false;

  return true;
}

export const ROLE_LABELS: Record<FirmRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export const ROLE_DESCRIPTIONS: Record<FirmRole, string> = {
  owner: 'Everything, including the subscription and who else can be an owner.',
  admin: 'Everything about clients, requests and the team. Not the subscription.',
  member: 'Collect and review documents. No settings, no team, no billing.',
};

/**
 * Whether an address is on a platform-admin list.
 *
 * Two forms, both comma-separated: a whole address (`ops@seziro.com`) or a domain
 * (`@seziro.com`) meaning everybody there. The domain form exists because an operator's
 * staff list changes more often than their deployment does, and a config change that needs
 * a restart is a config change people avoid making.
 *
 * ⚠️ Only ever list a domain you control the mailboxes for. Gather does not verify email
 * addresses at sign-up, so `@gmail.com` here would hand the operator console to anybody.
 *
 * Empty list, empty string, nobody. That is a self-hosted install: there is no operator,
 * because there is nobody above the firm running it.
 */
export function matchesAdminList(email: string, list: string | null | undefined): boolean {
  if (!list) return false;

  const address = email.trim().toLowerCase();
  if (!address.includes('@')) return false;
  const domain = address.slice(address.lastIndexOf('@'));

  return list
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith('@') ? entry === domain : entry === address));
}
