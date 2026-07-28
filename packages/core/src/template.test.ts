import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countItems,
  instantiateBody,
  parseTemplateBody,
  templateBodySchema,
  TemplateBodyError,
} from './template.js';
import { BUILTIN_TEMPLATES, findBuiltinTemplate } from './templates/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sourcesDoc = readFileSync(join(repoRoot, 'templates', 'SOURCES.md'), 'utf8');

describe('built-in templates', () => {
  it('ships exactly the four templates plan.md §7.1 promises', () => {
    expect(BUILTIN_TEMPLATES.map((entry) => entry.key)).toEqual([
      'us-individual-tax-year-end',
      'new-business-onboarding',
      'mortgage-application',
      'bookkeeping-monthly-close',
    ]);
  });

  it('gives every item at least one source', () => {
    const uncited: string[] = [];
    for (const template of BUILTIN_TEMPLATES) {
      for (const section of template.body.sections) {
        for (const item of section.items) {
          if (item.sources.length === 0) uncited.push(`${template.key}: ${item.label}`);
        }
      }
    }
    // The whole promise of the built-ins is that nothing in them was invented. An item
    // with no citation is the failure mode this test exists to catch.
    expect(uncited).toEqual([]);
  });

  it('cites only https URLs, and every one of them appears in templates/SOURCES.md', () => {
    const missing: string[] = [];
    for (const template of BUILTIN_TEMPLATES) {
      for (const section of template.body.sections) {
        for (const item of section.items) {
          for (const source of item.sources) {
            expect(source.url.startsWith('https://')).toBe(true);
            if (!sourcesDoc.includes(source.url)) missing.push(source.url);
          }
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('agrees with the section and item counts published in SOURCES.md', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const row = `| ${template.name} | \`${template.key}\` | ${template.body.sections.length} | ${countItems(template.body)} |`;
      expect(sourcesDoc).toContain(row);
    }
  });

  it('lists every item label in SOURCES.md', () => {
    const missing: string[] = [];
    for (const template of BUILTIN_TEMPLATES) {
      for (const section of template.body.sections) {
        if (!sourcesDoc.includes(section.title)) missing.push(`section: ${section.title}`);
        for (const item of section.items) {
          if (!sourcesDoc.includes(item.label)) missing.push(`item: ${item.label}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('covers all seven item types across the four templates', () => {
    const used = new Set(
      BUILTIN_TEMPLATES.flatMap((template) =>
        template.body.sections.flatMap((section) => section.items.map((item) => item.type)),
      ),
    );
    expect([...used].sort()).toEqual([
      'choice',
      'date',
      'file',
      'longtext',
      'number',
      'text',
      'yesno',
    ]);
  });

  it('finds a template by key and nothing by a made-up one', () => {
    expect(findBuiltinTemplate('mortgage-application')?.name).toBe(
      'Mortgage application documents',
    );
    expect(findBuiltinTemplate('not-a-template')).toBeUndefined();
  });
});

describe('instantiateBody', () => {
  const template = BUILTIN_TEMPLATES[0]!;

  it('shares no object with the template it copied', () => {
    const copy = instantiateBody(template.body);
    const original = JSON.stringify(template.body);

    copy.sections[0]!.title = 'Rewritten by the firm';
    copy.sections[0]!.items[0]!.label = 'Rewritten too';
    copy.sections[0]!.items.push({ ...copy.sections[0]!.items[0]! });

    // The template is a module-level constant shared by every instantiation. If the copy
    // were shallow, the second request built from this template would inherit the edits
    // made to the first — silently, and only in production.
    expect(JSON.stringify(template.body)).toBe(original);
  });

  it('produces the same result every time', () => {
    expect(instantiateBody(template.body)).toEqual(instantiateBody(template.body));
  });

  it('drops row ids and citations', () => {
    const withIds = parseTemplateBody({
      sections: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Section',
          items: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              type: 'text',
              label: 'Item',
              sources: [{ label: 'IRS', url: 'https://www.irs.gov/' }],
            },
          ],
        },
      ],
    });

    const copy = instantiateBody(withIds);
    expect(copy.sections[0]!.id).toBeUndefined();
    expect(copy.sections[0]!.items[0]!.id).toBeUndefined();
    expect(copy.sections[0]!.items[0]!.sources).toEqual([]);

    const kept = instantiateBody(withIds, { keepSources: true });
    expect(kept.sections[0]!.items[0]!.sources).toHaveLength(1);
  });
});

describe('templateBodySchema', () => {
  function body(item: unknown) {
    return { sections: [{ title: 'Section', items: [item] }] };
  }

  it('applies defaults for required and config', () => {
    const parsed = parseTemplateBody(body({ type: 'text', label: 'Name' }));
    const item = parsed.sections[0]!.items[0]!;
    expect(item.required).toBe(true);
    expect(item.config).toEqual({});
    expect(item.sources).toEqual([]);
  });

  it('accepts an empty request — a draft under construction is a real state', () => {
    expect(parseTemplateBody({ sections: [] }).sections).toEqual([]);
    expect(parseTemplateBody({ sections: [{ title: 'Empty', items: [] }] }).sections).toHaveLength(
      1,
    );
  });

  it('rejects a blank label', () => {
    expect(() => parseTemplateBody(body({ type: 'text', label: '   ' }))).toThrow(
      TemplateBodyError,
    );
  });

  it('rejects a choice item with fewer than two options', () => {
    expect(() =>
      parseTemplateBody(body({ type: 'choice', label: 'Pick', config: { options: ['Only'] } })),
    ).toThrow(/at least two options/);
  });

  it('rejects duplicate choice options', () => {
    expect(() =>
      parseTemplateBody(
        body({ type: 'choice', label: 'Pick', config: { options: ['Yes', 'Yes'] } }),
      ),
    ).toThrow(/unique/);
  });

  it('rejects an inverted date range and an inverted number range', () => {
    expect(() =>
      parseTemplateBody(
        body({ type: 'date', label: 'When', config: { min: '2026-12-01', max: '2026-01-01' } }),
      ),
    ).toThrow(/earliest date/);
    expect(() =>
      parseTemplateBody(body({ type: 'number', label: 'How much', config: { min: 10, max: 1 } })),
    ).toThrow(/minimum/);
  });

  it('rejects an unknown item type', () => {
    expect(() => parseTemplateBody(body({ type: 'signature', label: 'Sign here' }))).toThrow(
      TemplateBodyError,
    );
  });

  it('normalises accepted file extensions to lowercase', () => {
    const parsed = parseTemplateBody(
      body({ type: 'file', label: 'Statement', config: { accept: ['.PDF'] } }),
    );
    const item = parsed.sections[0]!.items[0]!;
    expect(item.type === 'file' && item.config.accept).toEqual(['.pdf']);
  });

  it('reports the offending path in a way a person can act on', () => {
    const result = templateBodySchema.safeParse({
      sections: [{ title: 'Income', items: [{ type: 'text', label: '' }] }],
    });
    expect(result.success).toBe(false);
    try {
      parseTemplateBody({ sections: [{ title: 'Income', items: [{ type: 'text', label: '' }] }] });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as TemplateBodyError).issues[0]).toContain('sections[1].items[1].label');
    }
  });
});
