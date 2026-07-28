import { ITEM_TYPE_LABELS, type ItemType, type TemplateBody } from '@gather/core';

/**
 * The builder's working copy of a request.
 *
 * Deliberately not `TemplateBody`: while someone is typing, "maximum files" is the string
 * `"1"` and then the empty string, not a number, and every item needs a stable React key
 * whether or not it has a database id yet. Converting to and from the validated shape
 * happens at the edges, in `toDraft` and `toBody`.
 */

export interface DraftItem {
  key: string;
  id?: string;
  type: ItemType;
  label: string;
  helpText: string;
  required: boolean;
  /** file */
  accept: string;
  maxFiles: string;
  /** text, longtext */
  placeholder: string;
  /** date */
  dateMin: string;
  dateMax: string;
  /** choice */
  options: string[];
  multiple: boolean;
  /** number */
  numberMin: string;
  numberMax: string;
  unit: string;
}

export interface DraftSection {
  key: string;
  id?: string;
  title: string;
  description: string;
  items: DraftItem[];
}

let sequence = 0;
export function nextKey(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function numberToInput(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

export function toDraft(body: TemplateBody): DraftSection[] {
  return body.sections.map((section) => ({
    key: nextKey('section'),
    ...(section.id ? { id: section.id } : {}),
    title: section.title,
    description: section.description ?? '',
    items: section.items.map((item) => ({
      key: nextKey('item'),
      ...(item.id ? { id: item.id } : {}),
      type: item.type,
      label: item.label,
      helpText: item.helpText ?? '',
      required: item.required,
      accept: item.type === 'file' ? (item.config.accept ?? []).join(', ') : '',
      maxFiles: item.type === 'file' ? numberToInput(item.config.maxFiles) : '',
      placeholder:
        item.type === 'text' || item.type === 'longtext' ? (item.config.placeholder ?? '') : '',
      dateMin: item.type === 'date' ? (item.config.min ?? '') : '',
      dateMax: item.type === 'date' ? (item.config.max ?? '') : '',
      options: item.type === 'choice' ? [...item.config.options] : ['', ''],
      multiple: item.type === 'choice' ? item.config.multiple : false,
      numberMin: item.type === 'number' ? numberToInput(item.config.min) : '',
      numberMax: item.type === 'number' ? numberToInput(item.config.max) : '',
      unit: item.type === 'number' ? (item.config.unit ?? '') : '',
    })),
  }));
}

export function newItem(type: ItemType): DraftItem {
  return {
    key: nextKey('item'),
    type,
    label: '',
    helpText: '',
    required: true,
    accept: '',
    maxFiles: '',
    placeholder: '',
    dateMin: '',
    dateMax: '',
    options: type === 'choice' ? ['', ''] : [],
    multiple: false,
    numberMin: '',
    numberMax: '',
    unit: '',
  };
}

export function newSection(): DraftSection {
  return { key: nextKey('section'), title: '', description: '', items: [] };
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function configFor(item: DraftItem): Record<string, unknown> {
  switch (item.type) {
    case 'file': {
      const accept = item.accept
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
        .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`));
      return {
        ...(accept.length > 0 ? { accept } : {}),
        ...(optionalNumber(item.maxFiles) === undefined
          ? {}
          : { maxFiles: optionalNumber(item.maxFiles) }),
      };
    }
    case 'text':
    case 'longtext':
      return optionalText(item.placeholder) === undefined
        ? {}
        : { placeholder: optionalText(item.placeholder) };
    case 'date':
      return {
        ...(optionalText(item.dateMin) === undefined ? {} : { min: optionalText(item.dateMin) }),
        ...(optionalText(item.dateMax) === undefined ? {} : { max: optionalText(item.dateMax) }),
      };
    case 'choice':
      return {
        options: item.options.map((option) => option.trim()).filter(Boolean),
        multiple: item.multiple,
      };
    case 'number':
      return {
        ...(optionalNumber(item.numberMin) === undefined
          ? {}
          : { min: optionalNumber(item.numberMin) }),
        ...(optionalNumber(item.numberMax) === undefined
          ? {}
          : { max: optionalNumber(item.numberMax) }),
        ...(optionalText(item.unit) === undefined ? {} : { unit: optionalText(item.unit) }),
      };
    case 'yesno':
      return {};
  }
}

/** The shape `templateBodySchema` parses. Validation still happens on the server. */
export function toBody(sections: DraftSection[]): unknown {
  return {
    sections: sections.map((section) => ({
      ...(section.id ? { id: section.id } : {}),
      title: section.title.trim(),
      ...(section.description.trim() ? { description: section.description.trim() } : {}),
      items: section.items.map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        type: item.type,
        label: item.label.trim(),
        ...(item.helpText.trim() ? { helpText: item.helpText.trim() } : {}),
        required: item.required,
        config: configFor(item),
      })),
    })),
  };
}

/**
 * Client-side checks that produce a message naming the offending item, rather than letting
 * the server reject the whole save with a path like `sections[2].items[4].label`.
 * The server validates the same rules regardless — this is for the human, not for safety.
 */
export function draftProblems(sections: DraftSection[]): string[] {
  const problems: string[] = [];
  sections.forEach((section, sectionIndex) => {
    const where = `Section ${sectionIndex + 1}`;
    if (!section.title.trim()) problems.push(`${where} needs a title.`);
    section.items.forEach((item, itemIndex) => {
      const item_where = `${where}, item ${itemIndex + 1} (${ITEM_TYPE_LABELS[item.type]})`;
      if (!item.label.trim()) problems.push(`${item_where} needs a label.`);
      if (item.type === 'choice') {
        const options = item.options.map((option) => option.trim()).filter(Boolean);
        if (options.length < 2) problems.push(`${item_where} needs at least two options.`);
        if (new Set(options).size !== options.length) {
          problems.push(`${item_where} has duplicate options.`);
        }
      }
    });
  });
  return problems;
}
