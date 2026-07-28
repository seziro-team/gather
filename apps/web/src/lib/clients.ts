import { and, asc, eq, isNull } from 'drizzle-orm';
import { appendAuditEvent, client, getDb } from '@gather/db';
import type { Actor } from './actor';

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
export async function listClients(firmId: string, includeArchived = false): Promise<Client[]> {
  const where = includeArchived
    ? eq(client.firmId, firmId)
    : and(eq(client.firmId, firmId), isNull(client.archivedAt));
  return getDb().select().from(client).where(where).orderBy(asc(client.name));
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
