import Link from 'next/link';
import type { Paginated } from '@gather/core';

/**
 * Paging controls, and the sentence that says where you are.
 *
 * Plain links rather than buttons: a page of a list is a place, so it should be
 * bookmarkable, shareable, and openable in a new tab. It also means paging works with
 * JavaScript off, which is not a hypothetical on a locked-down firm laptop.
 */
export function Pager({
  page,
  basePath,
  params = {},
  unit = 'row',
}: {
  page: Paginated<unknown>;
  basePath: string;
  /** Everything else in the query string — filters, search — carried across pages. */
  params?: Record<string, string | undefined>;
  unit?: string;
}) {
  if (page.total === 0) return null;

  function href(number: number): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    if (number > 1) query.set('page', String(number));
    const search = query.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  const plural = page.total === 1 ? unit : `${unit}s`;

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm"
      aria-label="Pagination"
    >
      <p className="text-slate-600" data-testid="pager-summary">
        {page.pages === 1 ? (
          <>
            {page.total} {plural}
          </>
        ) : (
          <>
            {page.from}–{page.to} of {page.total} {plural} · page {page.page} of {page.pages}
          </>
        )}
      </p>

      {page.pages > 1 ? (
        <div className="flex items-center gap-2">
          {page.hasPrevious ? (
            <Link
              href={href(page.page - 1)}
              rel="prev"
              data-testid="pager-previous"
              className="rounded-md px-3 py-1.5 ring-1 ring-slate-300 ring-inset hover:ring-slate-400"
            >
              ← Previous
            </Link>
          ) : null}
          {page.hasNext ? (
            <Link
              href={href(page.page + 1)}
              rel="next"
              data-testid="pager-next"
              className="rounded-md px-3 py-1.5 ring-1 ring-slate-300 ring-inset hover:ring-slate-400"
            >
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

/**
 * A search box that submits with GET.
 *
 * The result is a URL, so the search survives a reload and can be sent to a colleague —
 * and there is no client-side state to get out of step with what is on screen.
 */
export function SearchBox({
  action,
  value,
  placeholder,
  hidden = {},
}: {
  action: string;
  value: string;
  placeholder: string;
  /** Filters to preserve when searching. Paging is deliberately not among them. */
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([key, entry]) =>
        entry ? <input key={key} type="hidden" name={key} value={entry} /> : null,
      )}
      <input
        type="search"
        name="q"
        defaultValue={value}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid="search"
        className="focus:ring-brand-600 min-w-56 flex-1 rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-300 ring-inset focus:ring-2"
      />
      <button
        type="submit"
        className="rounded-md px-3 py-2 text-sm font-medium ring-1 ring-slate-300 ring-inset hover:ring-slate-400"
      >
        Search
      </button>
      {value ? (
        <Link href={action} className="text-brand-700 text-sm underline">
          Clear
        </Link>
      ) : null}
    </form>
  );
}
