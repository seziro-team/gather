/**
 * Paging for the list pages.
 *
 * Offset paging, deliberately, rather than keyset. A firm wants "the overdue ones, sorted
 * by how late they are, page 3" — and keyset cannot jump to page 3 or tell you there are
 * eleven pages. The sets here are thousands of rows, not millions, and both columns these
 * lists sort by are indexed, so the offset scan a purist would object to is not the thing
 * that will hurt first.
 *
 * What it replaces is worse than either: `select *` with no limit at all, rendering every
 * row a firm has ever had. That is fine for the twelve requests a demo has and unusable at
 * the four thousand a real January produces.
 */

export const DEFAULT_PAGE_SIZE = 25;

/** Hard ceiling on `?size=`, so a crafted URL cannot ask for the whole table. */
export const MAX_PAGE_SIZE = 100;

export interface Page {
  /** 1-based, because it is in a URL a person reads. */
  number: number;
  size: number;
  offset: number;
}

/**
 * Read a page number out of a query string.
 *
 * Anything unparseable is page 1. A list page that 500s because somebody typed `?page=abc`
 * is a worse outcome than one that shows the first page.
 */
export function parsePage(value: unknown, size = DEFAULT_PAGE_SIZE): Page {
  const requested = Number.parseInt(String(value ?? '1'), 10);
  const number = Number.isFinite(requested) && requested > 0 ? requested : 1;
  const clamped = Math.min(Math.max(Math.trunc(size) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  return { number, size: clamped, offset: (number - 1) * clamped };
}

export function parsePageSize(value: unknown): number {
  const requested = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(requested) || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
  /** 1-based index of the first row on this page; 0 when there are none. */
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Wrap a page of rows with everything a pager needs to render.
 *
 * `pages` is at least 1 so an empty list still reads "page 1 of 1" rather than "page 1 of
 * 0", which looks like a bug to the person reading it.
 */
export function paginate<T>(rows: T[], total: number, page: Page): Paginated<T> {
  const pages = Math.max(1, Math.ceil(total / page.size));
  const number = Math.min(page.number, pages);
  const from = total === 0 ? 0 : (number - 1) * page.size + 1;

  return {
    rows,
    total,
    page: number,
    size: page.size,
    pages,
    from,
    to: Math.min(number * page.size, total),
    hasPrevious: number > 1,
    hasNext: number < pages,
  };
}

/**
 * Normalise a search box's contents.
 *
 * Returns `null` for anything that would match everything, so callers can skip the filter
 * entirely rather than running `like '%%'` against every row.
 */
export function parseSearch(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (text.length === 0) return null;
  return text.slice(0, 200);
}

/**
 * Escape a search term for a SQL `LIKE`.
 *
 * Without this, a client called "50% deposit" searches for anything, and one with an
 * underscore in their name matches a character they did not type. Backslash first, or it
 * escapes the escapes.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
