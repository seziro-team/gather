import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { countItems, instantiateBody, parseTemplateBody, type TemplateBody } from '@gather/core';
import { appendAuditEvent, getDb, readRequestStructure, template } from '@gather/db';
import type { Actor } from './actor';
import { slugify } from './firm';

export type TemplateRow = typeof template.$inferSelect;

export interface TemplateSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  sections: number;
  items: number;
}

/** Built-ins are shared (`firm_id is null`); a firm also sees only its own saved templates. */
function visibleToFirm(firmId: string) {
  return or(isNull(template.firmId), eq(template.firmId, firmId));
}

export async function listTemplates(firmId: string): Promise<TemplateSummary[]> {
  const rows = await getDb()
    .select()
    .from(template)
    .where(visibleToFirm(firmId))
    .orderBy(asc(template.isBuiltin), asc(template.name));

  return rows
    .map(toSummary)
    .sort((a, b) =>
      a.isBuiltin === b.isBuiltin ? a.name.localeCompare(b.name) : a.isBuiltin ? -1 : 1,
    );
}

export function toSummary(row: TemplateRow): TemplateSummary {
  const body = parseTemplateBody(row.body);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isBuiltin: row.isBuiltin,
    sections: body.sections.length,
    items: countItems(body),
  };
}

export async function getTemplate(
  firmId: string,
  id: string,
): Promise<{ row: TemplateRow; body: TemplateBody } | null> {
  const rows = await getDb()
    .select()
    .from(template)
    .where(and(eq(template.id, id), visibleToFirm(firmId)))
    .limit(1);
  const row = rows[0];
  return row ? { row, body: parseTemplateBody(row.body) } : null;
}

/**
 * Save a request's current structure as a reusable template.
 *
 * `instantiateBody` is what makes this a copy rather than a link: row ids are dropped, so
 * editing the template later cannot reach back into the request it came from, and building
 * a request from it cannot collide with that request's rows.
 */
export async function saveRequestAsTemplate(
  actor: Actor,
  requestId: string,
  input: { name: string; description?: string | null },
): Promise<TemplateRow> {
  const db = getDb();
  const structure = await readRequestStructure(db, requestId);
  const body = instantiateBody(structure);

  return db.transaction(async (tx) => {
    const base = slugify(input.name);
    let key = base;
    for (let attempt = 1; ; attempt += 1) {
      const clash = await tx
        .select({ id: template.id })
        .from(template)
        .where(and(eq(template.firmId, actor.firmId), eq(template.key, key)))
        .limit(1);
      if (clash.length === 0) break;
      if (attempt > 50) throw new Error(`Could not derive a unique key from "${input.name}"`);
      key = `${base}-${attempt + 1}`;
    }

    const inserted = await tx
      .insert(template)
      .values({
        firmId: actor.firmId,
        key,
        name: input.name,
        description: input.description ?? null,
        body,
        isBuiltin: false,
      })
      .returning();
    const created = inserted[0];
    if (!created) throw new Error('template insert returned no row');

    await appendAuditEvent(tx, {
      action: 'template.created',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      requestId,
      targetType: 'template',
      targetId: created.id,
      metadata: {
        key,
        name: input.name,
        sections: body.sections.length,
        items: countItems(body),
        fromRequest: requestId,
      },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return created;
  });
}

/** Built-ins are shared and cannot be deleted by a firm; the `firm_id` filter enforces it. */
export async function deleteFirmTemplate(actor: Actor, id: string): Promise<TemplateRow> {
  return getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(template)
      .where(and(eq(template.id, id), eq(template.firmId, actor.firmId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new Error('Template not found');

    await appendAuditEvent(tx, {
      action: 'template.deleted',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: actor.firmId,
      targetType: 'template',
      targetId: row.id,
      metadata: { key: row.key, name: row.name },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });

    return row;
  });
}
