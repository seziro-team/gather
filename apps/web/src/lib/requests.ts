import { and, desc, eq, sql } from 'drizzle-orm';
import { countItems, instantiateBody, type TemplateBody } from '@gather/core';
import {
  appendAuditEvent,
  client,
  getDb,
  item,
  readRequestStructure,
  replaceRequestStructure,
  request,
  section,
} from '@gather/db';
import type { Actor } from './actor';
import { getTemplate } from './templates';

export type RequestRow = typeof request.$inferSelect;

export interface RequestSummary {
  id: string;
  title: string;
  status: RequestRow['status'];
  dueAt: Date | null;
  updatedAt: Date;
  templateKey: string | null;
  clientId: string;
  clientName: string;
  clientEmail: string;
  itemCount: number;
}

const itemCountSql = sql<number>`(
  select count(*)::int from ${item}
  join ${section} on ${section.id} = ${item.sectionId}
  where ${section.requestId} = ${request.id}
)`;

export async function listRequests(firmId: string): Promise<RequestSummary[]> {
  return getDb()
    .select({
      id: request.id,
      title: request.title,
      status: request.status,
      dueAt: request.dueAt,
      updatedAt: request.updatedAt,
      templateKey: request.templateKey,
      clientId: client.id,
      clientName: client.name,
      clientEmail: client.email,
      itemCount: itemCountSql,
    })
    .from(request)
    .innerJoin(client, eq(client.id, request.clientId))
    .where(eq(request.firmId, firmId))
    .orderBy(desc(request.updatedAt));
}

export async function getRequest(
  firmId: string,
  id: string,
): Promise<{ request: RequestRow; client: typeof client.$inferSelect } | null> {
  const rows = await getDb()
    .select({ request, client })
    .from(request)
    .innerJoin(client, eq(client.id, request.clientId))
    .where(and(eq(request.id, id), eq(request.firmId, firmId)))
    .limit(1);
  const row = rows[0];
  return row ? { request: row.request, client: row.client } : null;
}

export async function getRequestStructure(
  firmId: string,
  id: string,
): Promise<TemplateBody | null> {
  const found = await getRequest(firmId, id);
  if (!found) return null;
  return readRequestStructure(getDb(), id);
}

export interface CreateRequestInput {
  clientId: string;
  title: string;
  description?: string | null;
  dueAt?: Date | null;
  templateId?: string | null;
}

/**
 * Creates the request and its whole structure in one transaction, so a template that fails
 * halfway cannot leave a request with three of its five sections.
 */
export async function createRequest(actor: Actor, input: CreateRequestInput): Promise<RequestRow> {
  const db = getDb();

  const owner = await db
    .select({ id: client.id })
    .from(client)
    .where(and(eq(client.id, input.clientId), eq(client.firmId, actor.firmId)))
    .limit(1);
  if (owner.length === 0) throw new Error('Client not found');

  const template = input.templateId ? await getTemplate(actor.firmId, input.templateId) : null;
  if (input.templateId && !template) throw new Error('Template not found');

  // Copied here, before the transaction, so the request never shares structure with the
  // template it came from — editing one must never change the other.
  const body = template ? instantiateBody(template.body) : { sections: [] };

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(request)
      .values({
        firmId: actor.firmId,
        clientId: input.clientId,
        title: input.title,
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        templateKey: template?.row.key ?? null,
        createdBy: actor.actorId,
      })
      .returning();
    const created = inserted[0];
    if (!created) throw new Error('request insert returned no row');

    const change = await replaceRequestStructure(tx, created.id, body);

    await appendAuditEvent(tx, {
      action: 'request.created',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      requestId: created.id,
      targetType: 'request',
      targetId: created.id,
      metadata: {
        title: created.title,
        clientId: input.clientId,
        templateKey: template?.row.key ?? null,
        sections: change.sections,
        items: change.items,
      },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return created;
  });
}

export async function updateRequestDetails(
  actor: Actor,
  id: string,
  input: { title: string; description?: string | null; dueAt?: Date | null },
): Promise<RequestRow> {
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(request)
      .set({
        title: input.title,
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(request.id, id), eq(request.firmId, actor.firmId)))
      .returning();
    const row = updated[0];
    if (!row) throw new Error('Request not found');

    await appendAuditEvent(tx, {
      action: 'request.updated',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      requestId: row.id,
      targetType: 'request',
      targetId: row.id,
      metadata: { title: row.title, dueAt: row.dueAt?.toISOString() ?? null },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return row;
  });
}

export async function saveRequestStructure(
  actor: Actor,
  id: string,
  body: TemplateBody,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: request.id, status: request.status })
      .from(request)
      .where(and(eq(request.id, id), eq(request.firmId, actor.firmId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Request not found');
    if (row.status !== 'draft') {
      throw new Error('This request has already been sent, so its structure is fixed.');
    }

    const change = await replaceRequestStructure(tx, id, body);
    await tx.update(request).set({ updatedAt: new Date() }).where(eq(request.id, id));

    await appendAuditEvent(tx, {
      action: 'request.structure_updated',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      requestId: id,
      targetType: 'request',
      targetId: id,
      metadata: { ...change },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });
  });
}

export async function deleteRequest(actor: Actor, id: string): Promise<RequestRow> {
  const db = getDb();
  const structure = await readRequestStructure(db, id);

  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(request)
      .where(and(eq(request.id, id), eq(request.firmId, actor.firmId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new Error('Request not found');

    // The audit event survives the row: `audit_event` deliberately carries no foreign
    // keys, so `request_id` still identifies what was deleted (plan.md §4.4).
    await appendAuditEvent(tx, {
      action: 'request.deleted',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      requestId: row.id,
      targetType: 'request',
      targetId: row.id,
      metadata: {
        title: row.title,
        clientId: row.clientId,
        sections: structure.sections.length,
        items: countItems(structure),
      },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return row;
  });
}
