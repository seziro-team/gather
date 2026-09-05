import { describe, expect, it } from 'vitest';
import { describeValue, isAnswered, parseResponseValue, ResponseValueError } from './response.js';
import { templateItemSchema, type TemplateItem } from './template.js';

/** Items are built through the real schema so the configs under test are ones Gather ships. */
function item(input: unknown): TemplateItem {
  return templateItemSchema.parse(input);
}

const text = item({ type: 'text', label: 'Preferred name', config: { maxLength: 20 } });
const longtext = item({ type: 'longtext', label: 'Anything else?' });
const yesno = item({ type: 'yesno', label: 'Did you move house?' });
const date = item({
  type: 'date',
  label: 'Date of purchase',
  config: { min: '2025-01-01', max: '2025-12-31' },
});
const choice = item({
  type: 'choice',
  label: 'Filing status',
  config: { options: ['Single', 'Married filing jointly', 'Head of household'] },
});
const multi = item({
  type: 'choice',
  label: 'Which accounts?',
  config: { options: ['Checking', 'Savings', 'Credit card'], multiple: true },
});
const number = item({
  type: 'number',
  label: 'Business miles',
  config: { min: 0, max: 200_000, unit: 'miles' },
});
const upload = item({ type: 'file', label: 'Your W-2', config: { accept: ['.pdf'] } });

describe('parseResponseValue', () => {
  it('trims text and treats an emptied box as unanswered', () => {
    expect(parseResponseValue(text, '  Dana  ')).toBe('Dana');
    expect(parseResponseValue(text, '   ')).toBeNull();
    expect(parseResponseValue(text, null)).toBeNull();
    expect(parseResponseValue(longtext, undefined)).toBeNull();
  });

  it('enforces the item’s own length limit', () => {
    expect(() => parseResponseValue(text, 'x'.repeat(21))).toThrow(ResponseValueError);
    expect(parseResponseValue(text, 'x'.repeat(20))).toHaveLength(20);
  });

  it('refuses a type the control could not have produced', () => {
    expect(() => parseResponseValue(text, 42)).toThrow(ResponseValueError);
    expect(() => parseResponseValue(yesno, 'yes')).toThrow(ResponseValueError);
    expect(() => parseResponseValue(number, 'not a number')).toThrow(ResponseValueError);
    expect(() => parseResponseValue(date, '31/12/2025')).toThrow(ResponseValueError);
  });

  it('keeps a date inside the range the item declares', () => {
    expect(parseResponseValue(date, '2025-06-01')).toBe('2025-06-01');
    expect(() => parseResponseValue(date, '2024-12-31')).toThrow(/before 2025-01-01/);
    expect(() => parseResponseValue(date, '2026-01-01')).toThrow(/after 2025-12-31/);
  });

  it('only accepts options the item actually lists', () => {
    expect(parseResponseValue(choice, 'Single')).toBe('Single');
    expect(() => parseResponseValue(choice, 'Something else')).toThrow(ResponseValueError);
    expect(() => parseResponseValue(choice, ['Single'])).toThrow(ResponseValueError);
  });

  it('normalises a multi-select to the item’s own order and drops duplicates', () => {
    expect(parseResponseValue(multi, ['Credit card', 'Checking', 'Checking'])).toEqual([
      'Checking',
      'Credit card',
    ]);
    expect(parseResponseValue(multi, [])).toBeNull();
    expect(() => parseResponseValue(multi, ['Checking', 'Offshore'])).toThrow(ResponseValueError);
  });

  it('accepts a number from a form field, which arrives as a string', () => {
    expect(parseResponseValue(number, '1234')).toBe(1234);
    expect(parseResponseValue(number, 1234.5)).toBe(1234.5);
    expect(parseResponseValue(number, '')).toBeNull();
    expect(() => parseResponseValue(number, -1)).toThrow(/below the minimum/);
    expect(() => parseResponseValue(number, 200_001)).toThrow(/above the maximum/);
    expect(() => parseResponseValue(number, Number.POSITIVE_INFINITY)).toThrow(ResponseValueError);
  });

  it('ignores anything posted against a file item, because files are rows', () => {
    expect(parseResponseValue(upload, 'nice try')).toBeNull();
  });
});

describe('isAnswered', () => {
  it('counts a file item by what is attached, not by its value', () => {
    expect(isAnswered(upload, null, 0)).toBe(false);
    expect(isAnswered(upload, null, 1)).toBe(true);
  });

  it('counts "No" as an answer', () => {
    expect(isAnswered(yesno, false, 0)).toBe(true);
    expect(isAnswered(yesno, null, 0)).toBe(false);
  });

  it('counts zero as an answer', () => {
    expect(isAnswered(number, 0, 0)).toBe(true);
  });

  it('does not count an empty selection', () => {
    expect(isAnswered(multi, [], 0)).toBe(false);
    expect(isAnswered(multi, ['Checking'], 0)).toBe(true);
    expect(isAnswered(text, '   ', 0)).toBe(false);
  });
});

describe('describeValue', () => {
  it('renders each type the way a person would read it', () => {
    expect(describeValue(yesno, true)).toBe('Yes');
    expect(describeValue(yesno, false)).toBe('No');
    expect(describeValue(multi, ['Checking', 'Savings'])).toBe('Checking, Savings');
    expect(describeValue(number, 1200)).toBe('1200 miles');
    expect(describeValue(text, 'Dana')).toBe('Dana');
    expect(describeValue(text, null)).toBe('');
  });
});
