import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, instantiateBody, parseTemplateBody } from '@gather/core';
import { createDatabase, createPool, type Database } from './client.js';
import { testDatabaseUrl } from './test-database.js';
import { runMigrations } from './migrator.js';
import { seedBuiltinTemplates } from './seed.js';
import { readRequestStructure, replaceRequestStructure } from './structure.js';
import { auditEvent, auditHead } from './schema/audit.js';
import { client, firm, item, request, section, template } from './schema/gather.js';

/**
 * Integration tests against a real PostgreSQL instance. What is being checked here —
 * that row identity survives an edit, that a template copy is genuinely independent, and
 * that seeding is idempotent — only means anything against real rows.
 */
let pool: Pool;
let db: Database;
let firmId: string;
let clientId: string;

beforeAll(async () => {
  // Never the database in DATABASE_URL — see test-database.ts.
  pool = createPool(await testDatabaseUrl(), { max: 8 });
  db = createDatabase(pool);
  await runMigrations(pool, db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.delete(request);
  await db.delete(client);
  await db.delete(template);
  await db.delete(firm);
  await db.execute(sql`alter table audit_event disable trigger audit_event_append_only`);
  await db.execute(sql`delete from audit_event`);
  await db.execute(sql`alter table audit_event enable trigger audit_event_append_only`);
  await db.delete(auditHead);

  const firms = await db
    .insert(firm)
    .values({ name: 'Test & Co', slug: `test-${Date.now()}` })
    .returning({ id: firm.id });
  firmId = firms[0]!.id;

  const clients = await db
    .insert(client)
    .values({ firmId, name: 'A Client', email: 'client@example.test' })
    .returning({ id: client.id });
  clientId = clients[0]!.id;
});

async function newRequest(title = 'A request'): Promise<string> {
  const rows = await db.insert(request).values({ firmId, clientId, title }).returning({
    id: request.id,
  });
  return rows[0]!.id;
}

const simpleBody = parseTemplateBody({
  sections: [
    {
      title: 'Income',
      description: 'Everything you were paid',
      items: [
        { type: 'file', label: 'Form W-2', config: { accept: ['.pdf'] } },
        { type: 'text', label: 'Employer name', required: false },
      ],
    },
    {
      title: 'Deductions',
      items: [{ type: 'number', label: 'Charitable giving', config: { min: 0, unit: 'USD' } }],
    },
  ],
});

describe('replaceRequestStructure', () => {
  it('writes sections and items in order, and reads them back unchanged', async () => {
    const requestId = await newRequest();
    const change = await db.transaction((tx) => replaceRequestStructure(tx, requestId, simpleBody));

    expect(change).toEqual({
      sections: 2,
      items: 3,
      sectionsAdded: 2,
      sectionsRemoved: 0,
      itemsAdded: 3,
      itemsRemoved: 0,
    });

    const read = await readRequestStructure(db, requestId);
    expect(read.sections.map((entry) => entry.title)).toEqual(['Income', 'Deductions']);
    expect(read.sections[0]!.items.map((entry) => entry.label)).toEqual([
      'Form W-2',
      'Employer name',
    ]);
    expect(read.sections[0]!.items[1]!.required).toBe(false);
    const first = read.sections[0]!.items[0]!;
    expect(first.type === 'file' && first.config.accept).toEqual(['.pdf']);
  });

  it('keeps the row id of an item that was only edited', async () => {
    const requestId = await newRequest();
    await db.transaction((tx) => replaceRequestStructure(tx, requestId, simpleBody));
    const before = await readRequestStructure(db, requestId);
    const keptId = before.sections[0]!.items[0]!.id;
    expect(keptId).toBeDefined();

    const edited = structuredClone(before);
    edited.sections[0]!.items[0]!.label = 'Form W-2 (all employers)';
    await db.transaction((tx) => replaceRequestStructure(tx, requestId, edited));

    const after = await readRequestStructure(db, requestId);
    // Responses, files and review decisions all hang off item.id. Re-creating the row on
    // every save would throw away a client's answers without saying so.
    expect(after.sections[0]!.items[0]!.id).toBe(keptId);
    expect(after.sections[0]!.items[0]!.label).toBe('Form W-2 (all employers)');
  });

  it('reorders in place without changing any id', async () => {
    const requestId = await newRequest();
    await db.transaction((tx) => replaceRequestStructure(tx, requestId, simpleBody));
    const before = await readRequestStructure(db, requestId);
    const ids = before.sections[0]!.items.map((entry) => entry.id);

    const reordered = structuredClone(before);
    reordered.sections[0]!.items.reverse();
    await db.transaction((tx) => replaceRequestStructure(tx, requestId, reordered));

    const after = await readRequestStructure(db, requestId);
    expect(after.sections[0]!.items.map((entry) => entry.id)).toEqual([...ids].reverse());
    expect(after.sections[0]!.items.map((entry) => entry.label)).toEqual([
      'Employer name',
      'Form W-2',
    ]);
  });

  it('deletes what was removed and reports the counts', async () => {
    const requestId = await newRequest();
    await db.transaction((tx) => replaceRequestStructure(tx, requestId, simpleBody));
    const before = await readRequestStructure(db, requestId);

    const trimmed = structuredClone(before);
    trimmed.sections.pop();
    trimmed.sections[0]!.items.pop();
    const change = await db.transaction((tx) => replaceRequestStructure(tx, requestId, trimmed));

    expect(change.sectionsRemoved).toBe(1);
    expect(change.itemsRemoved).toBe(2);
    const rows = await db
      .select({ id: item.id })
      .from(item)
      .innerJoin(section, eq(section.id, item.sectionId))
      .where(eq(section.requestId, requestId));
    expect(rows).toHaveLength(1);
  });

  it('treats an id belonging to another request as a new row rather than adopting it', async () => {
    const mine = await newRequest('Mine');
    const theirs = await newRequest('Theirs');
    await db.transaction((tx) => replaceRequestStructure(tx, theirs, simpleBody));
    const victim = await readRequestStructure(db, theirs);
    const stolenSectionId = victim.sections[0]!.id!;
    const stolenItemId = victim.sections[0]!.items[0]!.id!;

    const forged = parseTemplateBody({
      sections: [
        {
          id: stolenSectionId,
          title: 'Injected',
          items: [{ id: stolenItemId, type: 'text', label: 'Injected item' }],
        },
      ],
    });
    await db.transaction((tx) => replaceRequestStructure(tx, mine, forged));

    // The other request must be untouched: an id it does not own is not a handle on it.
    const stillTheirs = await readRequestStructure(db, theirs);
    expect(stillTheirs.sections[0]!.title).toBe('Income');
    expect(stillTheirs.sections[0]!.items[0]!.label).toBe('Form W-2');

    const nowMine = await readRequestStructure(db, mine);
    expect(nowMine.sections[0]!.id).not.toBe(stolenSectionId);
    expect(nowMine.sections[0]!.items[0]!.id).not.toBe(stolenItemId);
  });

  it('handles a section that has no items', async () => {
    const requestId = await newRequest();
    await db.transaction((tx) =>
      replaceRequestStructure(
        tx,
        requestId,
        parseTemplateBody({ sections: [{ title: 'Empty', items: [] }] }),
      ),
    );
    const read = await readRequestStructure(db, requestId);
    expect(read.sections).toHaveLength(1);
    expect(read.sections[0]!.items).toEqual([]);
  });
});

describe('seedBuiltinTemplates', () => {
  it('installs the four templates and records each one', async () => {
    const result = await seedBuiltinTemplates(db);
    expect(result.installed).toHaveLength(4);
    expect(result.updated).toEqual([]);

    const rows = await db.select().from(template).where(isNull(template.firmId));
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.isBuiltin)).toBe(true);

    const events = await db.select().from(auditEvent);
    expect(events).toHaveLength(4);
    expect(events.every((event) => event.action === 'template.builtin_installed')).toBe(true);
    expect(events.every((event) => event.actorType === 'system')).toBe(true);
  });

  it('is idempotent — a second boot changes nothing and writes no events', async () => {
    await seedBuiltinTemplates(db);
    const before = await db.select().from(auditEvent);

    const again = await seedBuiltinTemplates(db);
    expect(again.installed).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.unchanged).toHaveLength(4);

    const after = await db.select().from(auditEvent);
    expect(after).toHaveLength(before.length);
  });

  it('repairs a template that was edited in the database, and says so', async () => {
    await seedBuiltinTemplates(db);
    await db
      .update(template)
      .set({ name: 'Tampered' })
      .where(and(eq(template.key, 'mortgage-application'), isNull(template.firmId)));

    const result = await seedBuiltinTemplates(db);
    expect(result.updated).toEqual(['mortgage-application']);

    const rows = await db
      .select()
      .from(template)
      .where(and(eq(template.key, 'mortgage-application'), isNull(template.firmId)));
    expect(rows[0]!.name).toBe('Mortgage application documents');

    const events = await db.select().from(auditEvent);
    expect(events.some((event) => event.action === 'template.builtin_updated')).toBe(true);
  });

  it('survives the jsonb round trip with the body intact', async () => {
    await seedBuiltinTemplates(db);
    for (const builtin of BUILTIN_TEMPLATES) {
      const rows = await db
        .select()
        .from(template)
        .where(and(eq(template.key, builtin.key), isNull(template.firmId)));
      expect(parseTemplateBody(rows[0]!.body)).toEqual(builtin.body);
    }
  });
});

describe('a request built from a template', () => {
  it('is a copy — editing it never reaches back into the template', async () => {
    await seedBuiltinTemplates(db);
    const rows = await db
      .select()
      .from(template)
      .where(and(eq(template.key, 'bookkeeping-monthly-close'), isNull(template.firmId)));
    const stored = rows[0]!;
    const original = parseTemplateBody(stored.body);

    const requestId = await newRequest('January close');
    await db.transaction((tx) => replaceRequestStructure(tx, requestId, instantiateBody(original)));

    const built = await readRequestStructure(db, requestId);
    const edited = structuredClone(built);
    edited.sections[0]!.title = 'Statements — ours';
    edited.sections[0]!.items[0]!.label = 'Our own wording';
    edited.sections.pop();
    await db.transaction((tx) => replaceRequestStructure(tx, requestId, edited));

    const templateAfter = await db
      .select()
      .from(template)
      .where(and(eq(template.key, 'bookkeeping-monthly-close'), isNull(template.firmId)));
    expect(parseTemplateBody(templateAfter[0]!.body)).toEqual(original);

    // And a second request built afterwards still gets the pristine checklist.
    const secondId = await newRequest('February close');
    await db.transaction((tx) =>
      replaceRequestStructure(
        tx,
        secondId,
        instantiateBody(parseTemplateBody(templateAfter[0]!.body)),
      ),
    );
    const second = await readRequestStructure(db, secondId);
    expect(second.sections.map((entry) => entry.title)).toEqual(
      original.sections.map((entry) => entry.title),
    );
    expect(second.sections[0]!.items[0]!.label).toBe(original.sections[0]!.items[0]!.label);
  });

  it('carries no source citations into the request', async () => {
    await seedBuiltinTemplates(db);
    const rows = await db
      .select()
      .from(template)
      .where(and(eq(template.key, 'us-individual-tax-year-end'), isNull(template.firmId)));
    const body = parseTemplateBody(rows[0]!.body);
    expect(body.sections[0]!.items[0]!.sources.length).toBeGreaterThan(0);

    const requestId = await newRequest('2026 tax');
    await db.transaction((tx) => replaceRequestStructure(tx, requestId, instantiateBody(body)));

    const built = await readRequestStructure(db, requestId);
    const cited = built.sections
      .flatMap((entry) => entry.items)
      .filter((entry) => entry.sources.length > 0);
    // A citation describes the item as Gather ships it. Once a firm can edit its copy,
    // repeating the citation would be a claim about text nobody at the IRS wrote.
    expect(cited).toEqual([]);
  });
});
