import { assertCan, type FirmRole, type Permission } from '@gather/core';
import { requestContext, type RequestContext } from './request-context';
import { requireReadyUser } from './session';

/**
 * Who is making a change, and from where.
 *
 * Every mutating helper takes one of these rather than reaching for the session itself, so
 * the firm scope on a query and the firm recorded in the audit event always come from the
 * same place. It also means those helpers can be exercised in tests without a request.
 */
export interface Actor {
  firmId: string;
  actorId: string;
  /**
   * What this person may do.
   *
   * Carried here so a mutating helper can refuse without a second lookup, and so that
   * forgetting to check is a visible omission at the call site rather than an invisible
   * one somewhere up the stack. Roles were in the schema from Phase 1 and enforced
   * nowhere until Phase 7 — this is what makes them mean something.
   */
  role: FirmRole;
  /** For anything a person reads — an invitation email says who sent it, and from where. */
  actorName: string;
  firmName: string;
  context: RequestContext;
}

export async function currentActor(): Promise<Actor> {
  const [{ user, membership }, context] = await Promise.all([requireReadyUser(), requestContext()]);
  return {
    firmId: membership.firm.id,
    actorId: user.id,
    role: membership.role,
    actorName: user.name,
    firmName: membership.firm.name,
    context,
  };
}

/** Refuse an action this role does not allow, with a message written for a person. */
export function requirePermission(actor: Actor, permission: Permission): void {
  assertCan(actor.role, permission);
}
