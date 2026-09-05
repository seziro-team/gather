import Link from 'next/link';
import { signOutAction } from '@/app/(auth)/actions';
import { Wordmark } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

/**
 * Its own shell, not the firm one.
 *
 * The operator console shows several firms at once, so a header saying "Hendricks & Co"
 * would be a lie. The dark bar is deliberate: it should never be possible to glance at a
 * screenshot and wonder whether you were looking at one firm's data or everyone's.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/admin" className="text-white">
            <Wordmark />
          </Link>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium">
            Platform admin
          </span>
          <nav className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link href="/dashboard" className="text-slate-300 hover:text-white">
              Back to your firm
            </Link>
            <span className="hidden text-slate-400 sm:inline">{user.email}</span>
            <form action={signOutAction}>
              <button type="submit" className="text-slate-300 underline hover:text-white">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
