import { z } from 'zod';

/**
 * The shape of a request: sections holding items, stored as `template.body` jsonb and
 * instantiated into `section` and `item` rows when a request is created from it.
 *
 * The same schema validates three things — the templates Gather ships, a template a firm
 * saves from one of its own requests, and the structure the builder posts back — so a
 * body that survives validation can always be instantiated.
 */

export const ITEM_TYPES = [
  'file',
  'text',
  'longtext',
  'yesno',
  'date',
  'choice',
  'number',
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

/** Human-readable names for the item types, used by the builder and the preview. */
export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  file: 'File upload',
  text: 'Short text',
  longtext: 'Long text',
  yesno: 'Yes / no',
  date: 'Date',
  choice: 'Choice',
  number: 'Number',
};

/**
 * Where an item came from. Every item in a built-in template carries at least one, which
 * is what keeps `templates/SOURCES.md` honest: the checklists Gather ships are transcribed
 * from published guidance, not invented.
 */
export const templateSourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  url: z.url(),
  /** What the source actually says, so a reader can check the item against it. */
  quote: z.string().trim().min(1).max(600).optional(),
});

export type TemplateSource = z.infer<typeof templateSourceSchema>;

const label = z.string().trim().min(1, 'A label is required').max(200);
const helpText = z.string().trim().max(1000).optional();
const isoDate = z.iso.date();

const fileConfig = z
  .object({
    /** Accepted extensions, lowercase and dot-prefixed. Empty means anything. */
    accept: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^\.[a-z0-9]{1,12}$/, 'must look like ".pdf"'),
      )
      .max(20)
      .optional(),
    maxFiles: z.number().int().min(1).max(50).optional(),
  })
  .default({});

const textConfig = z
  .object({
    placeholder: z.string().trim().max(120).optional(),
    maxLength: z.number().int().min(1).max(10_000).optional(),
  })
  .default({});

const dateConfig = z
  .object({
    min: isoDate.optional(),
    max: isoDate.optional(),
  })
  .refine((value) => !value.min || !value.max || value.min <= value.max, {
    message: 'the earliest date must not be after the latest date',
  })
  .default({});

const choiceConfig = z
  .object({
    options: z
      .array(z.string().trim().min(1).max(120))
      .min(2, 'A choice item needs at least two options')
      .max(30),
    multiple: z.boolean().default(false),
  })
  .refine((value) => new Set(value.options).size === value.options.length, {
    message: 'options must be unique',
  });

const numberConfig = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    /** Shown next to the input — "USD", "miles", "hours". */
    unit: z.string().trim().max(20).optional(),
  })
  .refine((value) => value.min === undefined || value.max === undefined || value.min <= value.max, {
    message: 'the minimum must not be greater than the maximum',
  })
  .default({});

const emptyConfig = z.object({}).default({});

const itemBase = {
  /**
   * The `item.id` this entry already has, when the builder posts a request it is editing.
   * Absent for anything new, and always absent in a stored template — carrying a row id
   * into a template would make every request built from it fight over the same row.
   */
  id: z.uuid().optional(),
  label,
  helpText,
  required: z.boolean().default(true),
  sources: z.array(templateSourceSchema).max(10).default([]),
};

export const templateItemSchema = z.discriminatedUnion('type', [
  z.object({ ...itemBase, type: z.literal('file'), config: fileConfig }),
  z.object({ ...itemBase, type: z.literal('text'), config: textConfig }),
  z.object({ ...itemBase, type: z.literal('longtext'), config: textConfig }),
  z.object({ ...itemBase, type: z.literal('yesno'), config: emptyConfig }),
  z.object({ ...itemBase, type: z.literal('date'), config: dateConfig }),
  z.object({ ...itemBase, type: z.literal('choice'), config: choiceConfig }),
  z.object({ ...itemBase, type: z.literal('number'), config: numberConfig }),
]);

export type TemplateItem = z.infer<typeof templateItemSchema>;
export type TemplateItemInput = z.input<typeof templateItemSchema>;

export const templateSectionSchema = z.object({
  id: z.uuid().optional(),
  title: label,
  description: z.string().trim().max(1000).optional(),
  items: z.array(templateItemSchema).max(200),
});

export type TemplateSection = z.infer<typeof templateSectionSchema>;
export type TemplateSectionInput = z.input<typeof templateSectionSchema>;

/**
 * A request's structure. Sections and items may both be empty: a draft under
 * construction is a legitimate state, and the builder saves whatever is on screen.
 * "Has at least one item" is a send-time rule, not a storage rule.
 */
export const templateBodySchema = z.object({
  sections: z.array(templateSectionSchema).max(50),
});

export type TemplateBody = z.infer<typeof templateBodySchema>;
export type TemplateBodyInput = z.input<typeof templateBodySchema>;

export class TemplateBodyError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid request structure:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'TemplateBodyError';
  }
}

/** Parse an untrusted body, throwing a message that is safe to show a user. */
export function parseTemplateBody(value: unknown): TemplateBody {
  const parsed = templateBodySchema.safeParse(value);
  if (!parsed.success) {
    throw new TemplateBodyError(
      parsed.error.issues.map((issue) => {
        const path = issue.path
          .map((part) => (typeof part === 'number' ? `[${part + 1}]` : part))
          .join('.')
          .replace(/\.\[/g, '[');
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    );
  }
  return parsed.data;
}

/**
 * A structural clone with every row id stripped, ready to become new rows.
 *
 * Used in both directions — template → new request, and request → new template — because
 * both need the same guarantee: the result must share no object and no identifier with the
 * thing it was copied from. Without the clone, editing a request built from a built-in
 * would mutate the shared definition in memory and change every request made afterwards.
 *
 * `keepSources` is false when copying a firm's own request into a template: a citation
 * describes an item as Gather ships it and stops being true the moment someone edits it.
 */
export function instantiateBody(body: TemplateBody, { keepSources = false } = {}): TemplateBody {
  return {
    sections: body.sections.map((section) => {
      const { id: _sectionId, items, ...rest } = structuredClone(section);
      return {
        ...rest,
        items: items.map((item) => {
          const { id: _itemId, ...copy } = item;
          return { ...copy, sources: keepSources ? copy.sources : [] };
        }),
      };
    }),
  };
}

export function countItems(body: TemplateBody): number {
  return body.sections.reduce((total, section) => total + section.items.length, 0);
}
