import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDb, listFirms, platformTotals, recordAuditEvent } from '@gather/db';
import { isPlatformAdmin } from './cloud';
import { requireUser, type SessionUser } from './session';

/**
 * The operator's side of the hosted tier.
 *
 * `notFound()` rather than a 403: somebody who is not an operator should not learn that
 * there is an operator console at all. And on a self-hosted install `GATHER_ADMIN_EMAILS`
 * is empty, `isPlatformAdmin` is false for everyone, and the whole route does not exist —
 * nobody running Gather on their own server has a Seziro back door into their data.
 *
 * Looking is itself audited. An operator who can read every firm's activity is exactly the
 * actor a firm most wants a record of.
 */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) notFound();
  return user;
}

export async function readAdminOverview() {
  const user = await requirePlatformAdmin();
  const head = await headers();
  const db = getDb();

  const [firms, totals] = await Promise.all([listFirms(db), platformTotals(db)]);

  await recordAuditEvent(db, {
    action: 'admin.console_viewed',
    actorType: 'user',
    actorId: user.id,
    targetType: 'platform',
    metadata: { firms: firms.length },
    ip: head.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    ua: head.get('user-agent'),
  });

  return { user, firms, totals };
}
