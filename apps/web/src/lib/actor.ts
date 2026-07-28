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
  context: RequestContext;
}

export async function currentActor(): Promise<Actor> {
  const [{ user, membership }, context] = await Promise.all([requireReadyUser(), requestContext()]);
  return { firmId: membership.firm.id, actorId: user.id, context };
}
