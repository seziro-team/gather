import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  likePattern,
  MAX_PAGE_SIZE,
  paginate,
  parsePage,
  parsePageSize,
  parseSearch,
} from './paging.js';

describe('reading a page out of a URL', () => {
  it('defaults to the first page for anything unparseable', () => {
    // A list page that 500s because somebody typed `?page=abc` is worse than one that
    // shows the first page, and both are reachable from a shared link.
    for (const value of [undefined, null, '', 'abc', '-3', '0', {}, []]) {
      expect(parsePage(value).number, `for ${JSON.stringify(value)}`).toBe(1);
      expect(parsePage(value).offset).toBe(0);
    }
  });

  it('computes the offset from a 1-based page', () => {
    expect(parsePage('3')).toEqual({ number: 3, size: DEFAULT_PAGE_SIZE, offset: 50 });
    expect(parsePage(2, 10)).toEqual({ number: 2, size: 10, offset: 10 });
  });

  it('caps the page size, so a crafted URL cannot ask for the whole table', () => {
    expect(parsePageSize('1000')).toBe(MAX_PAGE_SIZE);
    expect(parsePage('1', 1000).size).toBe(MAX_PAGE_SIZE);
    expect(parsePageSize('abc')).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize('0')).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize('10')).toBe(10);
  });
});

describe('describing a page', () => {
  it('reads as "1 of 1" when there is nothing, not "1 of 0"', () => {
    const empty = paginate([], 0, parsePage('1'));
    expect(empty).toMatchObject({ pages: 1, page: 1, from: 0, to: 0 });
    expect(empty.hasPrevious).toBe(false);
    expect(empty.hasNext).toBe(false);
  });

  it('counts the window a person is looking at', () => {
    const second = paginate(new Array(25).fill('row'), 60, parsePage('2'));
    expect(second).toMatchObject({ page: 2, pages: 3, from: 26, to: 50 });
    expect(second.hasPrevious).toBe(true);
    expect(second.hasNext).toBe(true);
  });

  it('ends the window at the total on a short last page', () => {
    expect(paginate(new Array(10).fill('row'), 60, parsePage('3'))).toMatchObject({
      from: 51,
      to: 60,
      hasNext: false,
    });
  });

  it('clamps a page past the end rather than showing nothing', () => {
    // Reachable by archiving rows while somebody is on the last page, or by editing the
    // URL. "Page 99 of 3, no rows" looks broken; the last page does not.
    const past = paginate([], 60, parsePage('99'));
    expect(past.page).toBe(3);
    expect(past.hasNext).toBe(false);
  });
});

describe('search terms', () => {
  it('treats blank input as no filter at all', () => {
    for (const value of [undefined, null, '', '   ']) expect(parseSearch(value)).toBeNull();
  });

  it('trims and bounds the term', () => {
    expect(parseSearch('  Rivera  ')).toBe('Rivera');
    expect(parseSearch('x'.repeat(500))).toHaveLength(200);
  });

  it('escapes LIKE wildcards, so a real name is not a wildcard', () => {
    // A client called "50% deposit" would otherwise match every row, and one with an
    // underscore would match a character nobody typed.
    expect(likePattern('50% deposit')).toBe('%50\\% deposit%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    // Backslash first, or the escapes get escaped.
    expect(likePattern('back\\slash')).toBe('%back\\\\slash%');
  });
});
