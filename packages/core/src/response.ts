import { z } from 'zod';
import type { TemplateItem } from './template.js';

/**
 * What a client's answer to one item is allowed to be.
 *
 * The item's own config is the schema — a choice item validates against *its* options, a
 * number item against *its* range. That matters because the portal is the one surface an
 * untrusted person posts to, and "the browser wouldn't send that" is not a control.
 *
 * `null` is a real value here, and it means *cleared*: a client who empties a box has
 * un-answered the item, which is different from never having touched it only in that we
 * have a row to prove it.
 */

export type ResponseValue = string | number | boolean | string[] | null;

export class ResponseValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseValueError';
  }
}

const isoDate = z.iso.date();

export function parseResponseValue(item: TemplateItem, raw: unknown): ResponseValue {
  switch (item.type) {
    case 'file':
      // Files are rows in `file`, not a value. Anything posted here is ignored rather
      // than rejected, so a client retrying a save cannot get stuck on it.
      return null;

    case 'text':
    case 'longtext': {
      if (raw === null || raw === undefined) return null;
      if (typeof raw !== 'string') throw new ResponseValueError('That answer should be text.');
      const text = raw.trim();
      if (text === '') return null;
      const limit = item.config.maxLength ?? 10_000;
      if (text.length > limit) {
        throw new ResponseValueError(`Please keep this under ${limit} characters.`);
      }
      return text;
    }

    case 'yesno': {
      if (raw === null || raw === undefined) return null;
      if (typeof raw !== 'boolean') throw new ResponseValueError('Answer yes or no.');
      return raw;
    }

    case 'date': {
      if (raw === null || raw === undefined || raw === '') return null;
      if (typeof raw !== 'string' || !isoDate.safeParse(raw).success) {
        throw new ResponseValueError('Enter a date as YYYY-MM-DD.');
      }
      if (item.config.min && raw < item.config.min) {
        throw new ResponseValueError(`That date is before ${item.config.min}.`);
      }
      if (item.config.max && raw > item.config.max) {
        throw new ResponseValueError(`That date is after ${item.config.max}.`);
      }
      return raw;
    }

    case 'choice': {
      const options = item.config.options;
      if (item.config.multiple) {
        if (raw === null || raw === undefined) return null;
        if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
          throw new ResponseValueError('Pick from the options listed.');
        }
        const chosen = [...new Set(raw as string[])];
        const unknown = chosen.find((entry) => !options.includes(entry));
        if (unknown !== undefined) {
          throw new ResponseValueError('Pick from the options listed.');
        }
        if (chosen.length === 0) return null;
        // Stored in the order the item lists them, so two clients picking the same
        // answers store the same value.
        return options.filter((option) => chosen.includes(option));
      }
      if (raw === null || raw === undefined || raw === '') return null;
      if (typeof raw !== 'string' || !options.includes(raw)) {
        throw new ResponseValueError('Pick from the options listed.');
      }
      return raw;
    }

    case 'number': {
      if (raw === null || raw === undefined || raw === '') return null;
      const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ResponseValueError('Enter a number.');
      }
      if (item.config.min !== undefined && value < item.config.min) {
        throw new ResponseValueError(`That is below the minimum of ${item.config.min}.`);
      }
      if (item.config.max !== undefined && value > item.config.max) {
        throw new ResponseValueError(`That is above the maximum of ${item.config.max}.`);
      }
      return value;
    }
  }
}

/** Whether an item counts as done, which is what drives the client's progress bar. */
export function isAnswered(item: TemplateItem, value: ResponseValue, fileCount: number): boolean {
  if (item.type === 'file') return fileCount > 0;
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** A short rendering of an answer for the firm's side of the product. */
export function describeValue(item: TemplateItem, value: ResponseValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number' && item.type === 'number' && item.config.unit) {
    return `${value} ${item.config.unit}`;
  }
  return String(value);
}
