import { Wordmark } from '@/components/ui';

export const metadata = { title: 'Link unavailable · Gather' };

/**
 * Where a link that no longer works lands.
 *
 * Deliberately vague about which reason applies to which link — it says what happened
 * without confirming that any particular token ever existed — and deliberately specific
 * about what the client should do, which is always the same thing: ask for a new one.
 */

const MESSAGES: Record<string, { title: string; body: string }> = {
  expired: {
    title: 'This link has expired',
    body: 'Links stop working after a while so that an old email cannot be used to reach your documents.',
  },
  revoked: {
    title: 'This link has been turned off',
    body: 'Whoever sent it has since revoked it. That usually means a newer link replaced it.',
  },
  archived: {
    title: 'This request has been closed',
    body: 'There is nothing left to send here.',
  },
  'not-found': {
    title: 'This link does not work',
    body: 'It may have been mistyped, or cut in half by an email program. Copying the whole address into your browser sometimes fixes it.',
  },
  'no-session': {
    title: 'You will need the link again',
    body: 'This browser is not signed in to a request. Opening the link from your email will bring you straight back.',
  },
};

const FALLBACK = MESSAGES['not-found']!;

export default async function UnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = (reason && MESSAGES[reason]) || FALLBACK;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <Wordmark className="mb-6 text-lg" />
      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">{message.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{message.body}</p>
        <p className="mt-4 text-sm text-slate-600">
          Ask the firm that sent it to send you a fresh link — nothing you have already uploaded is
          lost.
        </p>
      </div>
    </main>
  );
}
