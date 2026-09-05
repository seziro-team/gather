export const dynamic = 'force-dynamic';

export const metadata = { title: 'That invitation cannot be used', robots: { index: false } };

const REASONS: Record<string, string> = {
  'not-found': 'We do not recognise that invitation link.',
  revoked: 'That invitation was withdrawn.',
  expired: 'That invitation has expired.',
  'already-used': 'That invitation has already been accepted.',
};

/**
 * A page rather than a status code.
 *
 * Somebody clicking a dead invitation needs to know what to do next — ask for a new one —
 * not read a 401. The same reasoning as the portal's unavailable page.
 */
export default async function JoinUnavailable({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-12">
      <p className="text-sm font-medium text-slate-500">Gather</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">That invitation cannot be used</h1>
      <p className="mt-4 text-base text-slate-700">
        {REASONS[reason ?? ''] ?? 'That invitation cannot be used.'}
      </p>
      <p className="mt-2 text-base text-slate-700">
        Ask whoever invited you to send a new one — invitations last two weeks, and each one can be
        accepted once.
      </p>
    </main>
  );
}
