'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui';

/**
 * "Sign in with <your provider>".
 *
 * A client component because the OIDC round trip starts with a POST that answers with the
 * provider's authorization URL, and the browser then goes there. Better Auth's endpoint
 * does the discovery, the PKCE challenge and the state cookie; this only has to send the
 * request and follow where it points.
 *
 * `next` is carried through so an invitation link still works for somebody who has to sign
 * in first — the same `?next=` the password form honours, sanitised the same way.
 */
export function SsoButton({
  providerName,
  next,
  label,
}: {
  providerName: string;
  next: string;
  label?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/auth/sign-in/oauth2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'sso', callbackURL: next }),
      });

      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        message?: string;
      } | null;
      if (!response.ok || !payload?.url) {
        // Shown in full rather than as "something went wrong": the usual causes are a
        // discovery URL that does not resolve or a client id the provider does not know,
        // and both are fixed by reading the actual message.
        setError(payload?.message ?? `Could not start sign-in (${response.status}).`);
        setPending(false);
        return;
      }

      window.location.href = payload.url;
    } catch (caught) {
      setError((caught as Error).message);
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <button
        type="button"
        onClick={start}
        disabled={pending}
        data-testid="sso-sign-in"
        className="bg-brand-700 hover:bg-brand-800 flex min-h-12 w-full items-center justify-center rounded-md px-4 text-base font-medium text-white disabled:bg-slate-300 disabled:text-slate-600"
      >
        {pending ? 'Taking you there…' : (label ?? `Sign in with ${providerName}`)}
      </button>
    </div>
  );
}
