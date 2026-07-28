import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutAction } from '@/app/(auth)/actions';
import { Wordmark } from './ui';

export function AppShell({
  firmName,
  email,
  children,
}: {
  firmName: string;
  email: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/dashboard" className="text-slate-900">
            <Wordmark />
          </Link>
          <span className="text-sm text-slate-500">{firmName}</span>
          <nav className="ml-auto flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
              Dashboard
            </Link>
            <Link href="/account/security" className="text-slate-600 hover:text-slate-900">
              Security
            </Link>
            <span className="hidden text-slate-400 sm:inline">{email}</span>
            <form action={signOutAction}>
              <button type="submit" className="text-slate-600 underline hover:text-slate-900">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
