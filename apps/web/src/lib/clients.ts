import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { likePattern, paginate, type Page, type Paginated } from '@gather/core';
import { appendAuditEvent, client, getDb } from '@gather/db';
import { requirePermission, type Actor } from './actor';

export type Client = typeof client.$inferSelect;

export interface ClientInput {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
}

/**
 * Every read is filtered by `firm_id` in the query itself rather than checked afterwards.
 * A missing filter is then a missing row, not a leak — which matters because cross-firm
 * data reaching the wrong dashboard is the failure this product cannot survive.
 */
export async function listClients(
  firmId: string,
  options: { includeArchived?: boolean; search?: string | null; page: Page },
): Promise<Paginated<Client>> {
  const db = getDb();
  const filters: (SQL | undefined)[] = [eq(client.firmId, firmId)];
  if (!options.includeArchived) filters.push(isNull(client.archivedAt));

  if (options.search) {
    // Name, email or company — the three things somebody actually remembers about a client.
    // `ilike` rather than lowercasing both sides, so Postgres can still use an index if one
    // is added later; the pattern is escaped so "50% deposit" is a name and not a wildcard.
    const pattern = likePattern(options.search);
    filters.push(
      or(ilike(client.name, pattern), ilike(client.email, pattern), ilike(client.company, pattern)),
    );
  }

  const where = and(...filters);

  // Two queries rather than a window function: the count is over the same filter and
  // Postgres plans it independently, which is faster than carrying `count(*) over ()`
  // through a sorted, limited scan.
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(client)
      .where(where)
      .orderBy(asc(client.name))
      .limit(options.page.size)
      .offset(options.page.offset),
    db.select({ total: count() }).from(client).where(where),
  ]);

  return paginate(rows, totals[0]?.total ?? 0, options.page);
}

/** How many clients a picker will show before it stops being a picker. */
export const PICKER_LIMIT = 500;

/**
 * Clients for a `<select>`, bounded.
 *
 * Not the same question as the list page. A dropdown is a reasonable way to choose among
 * fifty clients and a bad one among four thousand, so this returns the first 500 by name
 * and the caller says so on screen. Unbounded was the previous behaviour and the worse
 * answer: it did not become unusable, it stayed usable while getting slower, until one day
 * it was neither.
 */
export async function pickableClients(firmId: string): Promise<Client[]> {
  return getDb()
    .select()
    .from(client)
    .where(and(eq(client.firmId, firmId), isNull(client.archivedAt)))
    .orderBy(asc(client.name))
    .limit(PICKER_LIMIT);
}

export async function getClient(firmId: string, id: string): Promise<Client | null> {
  const rows = await getDb()
    .select()
    .from(client)
    .where(and(eq(client.id, id), eq(client.firmId, firmId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createClient(actor: Actor, input: ClientInput): Promise<Client> {
  requirePermission(actor, 'clients:write');
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(client)
      .values({
        firmId: actor.firmId,
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        company: input.company ?? null,
      })
      .returning();
    const created = inserted[0];
    if (!created) throw new Error('client insert returned no row');

    await appendAuditEvent(tx, {
      action: 'client.created',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      targetType: 'client',
      targetId: created.id,
      metadata: { name: created.name, email: created.email },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return created;
  });
}

export async function updateClient(actor: Actor, id: string, input: ClientInput): Promise<Client> {
  requirePermission(actor, 'clients:write');
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(client)
      .set({
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        company: input.company ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(client.id, id), eq(client.firmId, actor.firmId)))
      .returning();
    const row = updated[0];
    if (!row) throw new Error('Client not found');

    await appendAuditEvent(tx, {
      action: 'client.updated',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      targetType: 'client',
      targetId: row.id,
      metadata: { name: row.name, email: row.email },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return row;
  });
}

/**
 * Archiving rather than deleting. A client with requests behind it is evidence; the
 * `request.client_id` foreign key is `on delete restrict` for the same reason.
 */
export async function setClientArchived(
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<Client> {
  requirePermission(actor, 'clients:write');
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(client)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(client.id, id), eq(client.firmId, actor.firmId)))
      .returning();
    const row = updated[0];
    if (!row) throw new Error('Client not found');

    await appendAuditEvent(tx, {
      action: archived ? 'client.archived' : 'client.restored',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      targetType: 'client',
      targetId: row.id,
      metadata: { name: row.name },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return row;
  });
}
