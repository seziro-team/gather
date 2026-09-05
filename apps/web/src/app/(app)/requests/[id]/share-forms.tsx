'use client';

import { useState, useTransition } from 'react';
import { Alert, Badge, Button } from '@/components/ui';
import { createPortalLinkAction, firmDownloadLinkAction, revokePortalLinkAction } from '../actions';

/**
 * Creating, showing and revoking a client's link.
 *
 * The link appears once. Gather stores only its SHA-256, so it genuinely cannot be shown
 * again — the copy in this box is the only one that will ever exist, and the text says so
 * rather than pretending otherwise.
 */

export interface LinkRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  opens: number;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function PortalLinks({ requestId, links }: { requestId: string; links: LinkRow[] }) {
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function create() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createPortalLinkAction(requestId);
      if (result.ok) setIssued({ url: result.url, expiresAt: result.expiresAt });
      else setError(result.error);
    });
  }

  function revoke(tokenId: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokePortalLinkAction(requestId, tokenId);
      if (!result.ok) setError(result.error);
    });
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an insecure origin,
      // a locked-down browser. The link is on screen and selectable either way.
      setError('Could not reach the clipboard. Select the link above and copy it by hand.');
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {issued ? (
        <div
          data-testid="issued-link"
          className="rounded-lg bg-emerald-50 p-4 ring-1 ring-emerald-200"
        >
          <p className="text-sm font-semibold text-emerald-900">
            Here is the link. Copy it now — it will not be shown again.
          </p>
          <code
            data-testid="portal-url"
            className="mt-2 block rounded-md bg-white p-3 font-mono text-xs break-all text-slate-800 ring-1 ring-slate-200"
          >
            {issued.url}
          </code>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={copy} variant="secondary">
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <span className="text-xs text-emerald-900">
              Works until {formatDate(issued.expiresAt)}
            </span>
          </div>
        </div>
      ) : null}

      <Button type="button" onClick={create} disabled={isPending} data-testid="create-link">
        {isPending ? 'Creating…' : links.length > 0 ? 'Create another link' : 'Create portal link'}
      </Button>

      {links.length > 0 ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {links.map((link) => {
            const dead = link.revokedAt !== null || new Date(link.expiresAt) <= new Date();
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <span className="font-mono text-xs text-slate-400">{link.id.slice(0, 8)}</span>
                <span className="text-sm text-slate-700">Created {formatDate(link.createdAt)}</span>
                {link.revokedAt ? (
                  <Badge>Revoked</Badge>
                ) : new Date(link.expiresAt) <= new Date() ? (
                  <Badge>Expired</Badge>
                ) : (
                  <Badge tone="green">Active</Badge>
                )}
                <span className="text-xs text-slate-500">
                  {link.opens === 0
                    ? 'Never opened'
                    : `Opened ${link.opens} time${link.opens === 1 ? '' : 's'}`}
                  {link.lastUsedAt ? `, last ${formatDate(link.lastUsedAt)}` : null}
                </span>
                {dead ? null : (
                  <button
                    type="button"
                    onClick={() => revoke(link.id)}
                    disabled={isPending}
                    className="ml-auto text-sm font-medium text-red-700 underline"
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Downloads are minted on click rather than rendered into the page, so the five-minute
 * expiry counts from the moment somebody wants the file — not from whenever the tab was
 * opened.
 */
export function DownloadButton({
  requestId,
  fileId,
  name,
}: {
  requestId: string;
  fileId: string;
  name: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await firmDownloadLinkAction(requestId, fileId);
            if (result.ok) window.location.href = result.url;
            else setError(result.error);
          })
        }
        aria-label={`Download ${name}`}
        className="text-brand-700 text-sm font-medium underline"
      >
        {isPending ? 'Preparing…' : 'Download'}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </>
  );
}
