import { eq } from 'drizzle-orm';
import { firmUser, getDb, recordAuditEvent, type RecordAuditInput } from '@gather/db';
import { requestContext } from './request-context';

/**
 * Record an audit event attributed to a signed-in firm user, filling in the firm and the
 * caller's IP and user agent.
 *
 * Used where Better Auth's own hooks cannot see the actor — most importantly sign-out,
 * where the after-hook runs once the session has already been revoked and there is
 * nothing left to identify.
 */
export async function auditForUser(
  userId: string,
  action: string,
  extra: Partial<RecordAuditInput> = {},
): Promise<void> {
  const db = getDb();
  const membership = await db
    .select({ firmId: firmUser.firmId })
    .from(firmUser)
    .where(eq(firmUser.userId, userId))
    .limit(1);
  const context = await requestContext();

  await recordAuditEvent(db, {
    actorType: 'user',
    actorId: userId,
    firmId: membership[0]?.firmId ?? null,
    targetType: 'user',
    targetId: userId,
    ip: context.ip,
    ua: context.ua,
    ...extra,
    action,
  });
}
