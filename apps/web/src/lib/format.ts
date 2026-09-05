/**
 * Presentation helpers shared by server and client components.
 *
 * This file deliberately has no `'use client'` directive. Anything a Server Component
 * calls has to live outside a client module — Next refuses to invoke a function exported
 * from a `'use client'` file on the server, and the failure only appears at render time,
 * on a page that happens to have data in it.
 */

/**
 * A file size a person recognises.
 *
 * One decimal place under 10 and none above, so "1.4 MB" and "24 MB" rather than
 * "1.44 MB" and "23.8 MB" — the extra digit is noise on a page listing documents.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
