import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { PortalScreen } from '@/components/portal/screen';
import { currentPortal } from '@/lib/portal';
import { readPortalView } from '@/lib/portal-data';

/**
 * The client's page. No account, no password, no app — plan.md §1.
 *
 * Rendered per request and never cached: the whole point is that it shows exactly what has
 * been received so far, and a client who uploads on their phone and then opens the link on
 * a laptop must see the same thing.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your document checklist',
  robots: { index: false, follow: false },
};

/** Only a plain hex colour is ever interpolated into a style attribute. */
const HEX = /^#[0-9a-f]{3,8}$/i;

interface BrandSnapshot {
  name?: string;
  logoUrl?: string | null;
  brandColor?: string;
}

/**
 * A firm's colour, spread across the shades the portal uses.
 *
 * Tailwind 4 compiles `bg-brand-700` to `var(--color-brand-700)`, so overriding the
 * variables on a wrapper re-tints everything inside it — no second stylesheet, no
 * per-firm build.
 */
function brandStyle(color: string): CSSProperties {
  if (!HEX.test(color)) return {};
  return {
    '--color-brand-50': `color-mix(in oklab, ${color} 10%, white)`,
    '--color-brand-500': `color-mix(in oklab, ${color} 90%, white)`,
    '--color-brand-600': color,
    '--color-brand-700': `color-mix(in oklab, ${color} 88%, black)`,
    '--color-brand-800': `color-mix(in oklab, ${color} 76%, black)`,
    '--color-brand-900': `color-mix(in oklab, ${color} 64%, black)`,
  } as CSSProperties;
}

export default async function PortalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const portal = await currentPortal(id);
  if (!portal) redirect('/portal/unavailable?reason=no-session');

  const view = await readPortalView(portal.request.id);

  // Branding is read from the snapshot frozen when the request was sent, so a firm that
  // changes its colours next year does not retroactively restyle what this client saw.
  const snapshot = (portal.request.brandSnapshot ?? null) as BrandSnapshot | null;
  const firmName = snapshot?.name ?? portal.firm.name;
  const logoUrl = snapshot?.logoUrl ?? portal.firm.logoUrl;
  const color = snapshot?.brandColor ?? portal.firm.brandColor;

  const due = portal.request.dueAt
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'long',
        timeZone: portal.firm.timezone,
      }).format(portal.request.dueAt)
    : null;

  return (
    <div style={brandStyle(color)} className="min-h-dvh">
      <header className="bg-brand-700 text-white">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a firm's own URL, not a build-time asset
            <img src={logoUrl} alt={firmName} className="mb-3 h-8 w-auto" />
          ) : (
            <p className="text-sm font-medium opacity-90">{firmName}</p>
          )}
          <h1 className="mt-1 text-2xl font-semibold break-words">{portal.request.title}</h1>
          {portal.request.description ? (
            <p className="mt-2 text-sm break-words opacity-90">{portal.request.description}</p>
          ) : null}
          <p className="mt-3 text-sm opacity-90">
            For {portal.client.name}
            {due ? ` · needed by ${due}` : null}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-16">
        <PortalScreen requestId={portal.request.id} view={view} status={portal.request.status} />

        <p className="mt-10 text-center text-xs text-slate-500">
          Your answers save as you go. This link is yours — anyone who has it can see this page, so
          please do not forward it.
        </p>
      </main>
    </div>
  );
}
