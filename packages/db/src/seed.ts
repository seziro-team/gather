import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  BUILTIN_TEMPLATES,
  canonicalJson,
  countItems,
  type JsonValue,
  type TemplateBody,
} from '@gather/core';
import { appendAuditEvent } from './audit.js';
import type { Database } from './client.js';
import { template } from './schema/gather.js';

/**
 * Installs the templates Gather ships.
 *
 * Runs at boot rather than behind a manual command, because a fresh install that offers
 * an empty template list has failed the "genuinely great self-host" test in CLAUDE.md §5
 * before the operator has done anything wrong. `pnpm seed:templates` runs the same code
 * from a source checkout.
 *
 * Built-ins are firm-independent — `firm_id` is null and the partial unique index
 * `template_builtin_key` keeps one row per key globally. A firm's own templates live
 * alongside them, scoped by `firm_id`, and are never touched here.
 */

/** Serialises seeding across replicas booting together. Migrations use 8410570002. */
const SEED_LOCK_SQL = sql`select pg_advisory_xact_lock(8410570003)`;

export interface SeedResult {
  installed: string[];
  updated: string[];
  unchanged: string[];
}

export async function seedBuiltinTemplates(db: Database): Promise<SeedResult> {
  const result: SeedResult = { installed: [], updated: [], unchanged: [] };

  await db.transaction(async (tx) => {
    await tx.execute(SEED_LOCK_SQL);

    for (const builtin of BUILTIN_TEMPLATES) {
      const rows = await tx
        .select()
        .from(template)
        .where(and(eq(template.key, builtin.key), isNull(template.firmId)))
        .limit(1);
      const existing = rows[0];

      const metadata = {
        key: builtin.key,
        name: builtin.name,
        sections: builtin.body.sections.length,
        items: countItems(builtin.body),
      };

      if (!existing) {
        const inserted = await tx
          .insert(template)
          .values({
            firmId: null,
            key: builtin.key,
            name: builtin.name,
            description: builtin.description,
            body: builtin.body,
            isBuiltin: true,
          })
          .returning({ id: template.id });
        const row = inserted[0];
        if (!row) throw new Error(`template insert returned no row for ${builtin.key}`);

        await appendAuditEvent(tx, {
          action: 'template.builtin_installed',
          actorType: 'system',
          targetType: 'template',
          targetId: row.id,
          metadata,
        });
        result.installed.push(builtin.key);
        continue;
      }

      const same =
        existing.name === builtin.name &&
        existing.description === builtin.description &&
        existing.isBuiltin &&
        canonicalJson(existing.body as JsonValue) ===
          canonicalJson(builtin.body as unknown as JsonValue);

      if (same) {
        result.unchanged.push(builtin.key);
        continue;
      }

      await tx
        .update(template)
        .set({
          name: builtin.name,
          description: builtin.description,
          body: builtin.body,
          isBuiltin: true,
          updatedAt: new Date(),
        })
        .where(eq(template.id, existing.id));

      // Worth recording: an upgrade that changes what Gather asks clients for is a change
      // a firm should be able to see, and date.
      await appendAuditEvent(tx, {
        action: 'template.builtin_updated',
        actorType: 'system',
        targetType: 'template',
        targetId: existing.id,
        metadata,
      });
      result.updated.push(builtin.key);
    }
  });

  return result;
}

/** The bodies as shipped, for tests and for the docs generator. */
export function builtinBodies(): Record<string, TemplateBody> {
  return Object.fromEntries(BUILTIN_TEMPLATES.map((entry) => [entry.key, entry.body]));
}
