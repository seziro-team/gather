/**
 * Where to send somebody after they sign in.
 *
 * An open redirect is the classic way a sign-in page becomes a phishing tool: send a victim
 * to a real, correctly-certificated `/sign-in?next=https://evil.example`, and the site they
 * trust delivers them somewhere else. So only a path on this origin survives — anything with
 * a scheme, a host, a protocol-relative `//`, or a backslash (which some browsers normalise
 * to `/`) is dropped and the caller falls back to the dashboard.
 */
export function safeNext(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.includes('\\')) return fallback;
  return value;
}
