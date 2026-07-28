import { eq } from 'drizzle-orm';
import { appendAuditEvent, firm, firmUser, getDb } from '@gather/db';
import type { RequestContext } from './request-context';

export type Firm = typeof firm.$inferSelect;
export type FirmRole = (typeof firmUser.$inferSelect)['role'];

export interface Membership {
  firm: Firm;
  role: FirmRole;
}

export async function getMembership(userId: string): Promise<Membership | null> {
  const rows = await getDb()
    .select({ firm, role: firmUser.role })
    .from(firmUser)
    .innerJoin(firm, eq(firm.id, firmUser.firmId))
    .where(eq(firmUser.userId, userId))
    .limit(1);
  const row = rows[0];
  return row ? { firm: row.firm, role: row.role } : null;
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'firm';
}

/**
 * Create a firm and make `userId` its owner, atomically with the audit events that
 * record it. If any part fails, nothing is written — there is no state where a firm
 * exists without an owner or without an audit trail.
 */
export async function createFirmForUser(input: {
  userId: string;
  name: string;
  timezone?: string;
  context: RequestContext;
}): Promise<Firm> {
  const base = slugify(input.name);

  return getDb().transaction(async (tx) => {
    let slug = base;
    for (let attempt = 1; ; attempt += 1) {
      const clash = await tx.select({ id: firm.id }).from(firm).where(eq(firm.slug, slug)).limit(1);
      if (clash.length === 0) break;
      if (attempt > 50) throw new Error(`Could not derive a unique slug from "${input.name}"`);
      slug = `${base}-${attempt + 1}`;
    }

    const inserted = await tx
      .insert(firm)
      .values({ name: input.name, slug, timezone: input.timezone ?? 'UTC' })
      .returning();
    const created = inserted[0];
    if (!created) throw new Error('firm insert returned no row');

    await tx.insert(firmUser).values({ firmId: created.id, userId: input.userId, role: 'owner' });

    await appendAuditEvent(tx, {
      action: 'firm.created',
      actorType: 'user',
      actorId: input.userId,
      firmId: created.id,
      targetType: 'firm',
      targetId: created.id,
      metadata: { name: created.name, slug: created.slug },
      ip: input.context.ip,
      ua: input.context.ua,
    });

    await appendAuditEvent(tx, {
      action: 'firm.member_added',
      actorType: 'user',
      actorId: input.userId,
      firmId: created.id,
      targetType: 'user',
      targetId: input.userId,
      metadata: { role: 'owner' },
      ip: input.context.ip,
      ua: input.context.ua,
    });

    return created;
  });
}
