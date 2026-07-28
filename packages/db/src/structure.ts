import { asc, eq, inArray } from 'drizzle-orm';
import { parseTemplateBody, type TemplateBody } from '@gather/core';
import type { Database, DbTransaction } from './client.js';
import { item, section } from './schema/gather.js';

/**
 * Moving a request's structure between `section`/`item` rows and the JSON shape the
 * builder and the templates both speak.
 *
 * Rows rather than a single jsonb blob because responses, files and reviews all hang off
 * `item.id`: a request whose structure is one document could not have a client answer
 * half of it.
 */

export interface StructureChange {
  sections: number;
  items: number;
  sectionsAdded: number;
  sectionsRemoved: number;
  itemsAdded: number;
  itemsRemoved: number;
}

export async function readRequestStructure(
  db: Database | DbTransaction,
  requestId: string,
): Promise<TemplateBody> {
  const rows = await db
    .select({
      sectionId: section.id,
      sectionTitle: section.title,
      sectionDescription: section.description,
      sectionPosition: section.position,
      itemId: item.id,
      itemType: item.type,
      itemLabel: item.label,
      itemHelpText: item.helpText,
      itemRequired: item.required,
      itemPosition: item.position,
      itemConfig: item.config,
    })
    .from(section)
    .leftJoin(item, eq(item.sectionId, section.id))
    .where(eq(section.requestId, requestId))
    .orderBy(asc(section.position), asc(section.id), asc(item.position), asc(item.id));

  const sections: unknown[] = [];
  let currentId: string | null = null;
  let current: { id: string; title: string; description?: string; items: unknown[] } | null = null;

  for (const row of rows) {
    if (row.sectionId !== currentId) {
      currentId = row.sectionId;
      current = {
        id: row.sectionId,
        title: row.sectionTitle,
        ...(row.sectionDescription === null ? {} : { description: row.sectionDescription }),
        items: [],
      };
      sections.push(current);
    }
    if (row.itemId && current) {
      current.items.push({
        id: row.itemId,
        type: row.itemType,
        label: row.itemLabel,
        ...(row.itemHelpText === null ? {} : { helpText: row.itemHelpText }),
        required: row.itemRequired,
        config: row.itemConfig,
      });
    }
  }

  // Parsed rather than trusted: a config that no longer satisfies its own schema should
  // surface here, loudly, instead of reaching the builder as a broken control.
  return parseTemplateBody({ sections });
}

/**
 * Make the stored rows match `body`, preserving the identity of anything the builder sent
 * back with an id.
 *
 * Identity matters beyond tidiness: `response`, `file` and every review decision reference
 * `item.id`. Rewriting the rows on each save would silently discard a client's answers.
 *
 * An id that does not already belong to this request is treated as new rather than
 * honoured. That is the whole defence against a crafted payload adopting another firm's
 * row, and it degrades gracefully when two tabs edit the same draft.
 */
export async function replaceRequestStructure(
  tx: DbTransaction,
  requestId: string,
  body: TemplateBody,
): Promise<StructureChange> {
  const existingSections = await tx
    .select({ id: section.id })
    .from(section)
    .where(eq(section.requestId, requestId));
  const existingSectionIds = new Set(existingSections.map((row) => row.id));

  const existingItems =
    existingSectionIds.size === 0
      ? []
      : await tx
          .select({ id: item.id })
          .from(item)
          .where(inArray(item.sectionId, [...existingSectionIds]));
  const existingItemIds = new Set(existingItems.map((row) => row.id));

  const keptSectionIds = new Set<string>();
  const keptItemIds = new Set<string>();

  const plan = body.sections.map((entry, sectionIndex) => {
    const id = entry.id && existingSectionIds.has(entry.id) ? entry.id : null;
    if (id) keptSectionIds.add(id);
    return {
      id,
      position: sectionIndex,
      title: entry.title,
      description: entry.description ?? null,
      items: entry.items.map((child, itemIndex) => {
        const childId = child.id && existingItemIds.has(child.id) ? child.id : null;
        if (childId) keptItemIds.add(childId);
        return {
          id: childId,
          position: itemIndex,
          type: child.type,
          label: child.label,
          helpText: child.helpText ?? null,
          required: child.required,
          config: child.config,
        };
      }),
    };
  });

  const removedItemIds = [...existingItemIds].filter((id) => !keptItemIds.has(id));
  if (removedItemIds.length > 0) {
    await tx.delete(item).where(inArray(item.id, removedItemIds));
  }
  const removedSectionIds = [...existingSectionIds].filter((id) => !keptSectionIds.has(id));
  if (removedSectionIds.length > 0) {
    await tx.delete(section).where(inArray(section.id, removedSectionIds));
  }

  let itemsAdded = 0;
  let items = 0;

  for (const entry of plan) {
    let sectionId = entry.id;
    if (sectionId) {
      await tx
        .update(section)
        .set({ title: entry.title, description: entry.description, position: entry.position })
        .where(eq(section.id, sectionId));
    } else {
      const inserted = await tx
        .insert(section)
        .values({
          requestId,
          title: entry.title,
          description: entry.description,
          position: entry.position,
        })
        .returning({ id: section.id });
      const row = inserted[0];
      if (!row) throw new Error('section insert returned no row');
      sectionId = row.id;
    }

    for (const child of entry.items) {
      items += 1;
      const values = {
        sectionId,
        type: child.type,
        label: child.label,
        helpText: child.helpText,
        required: child.required,
        position: child.position,
        config: child.config,
      };
      if (child.id) {
        await tx.update(item).set(values).where(eq(item.id, child.id));
      } else {
        await tx.insert(item).values(values);
        itemsAdded += 1;
      }
    }
  }

  return {
    sections: plan.length,
    items,
    sectionsAdded: plan.filter((entry) => entry.id === null).length,
    sectionsRemoved: removedSectionIds.length,
    itemsAdded,
    itemsRemoved: removedItemIds.length,
  };
}
