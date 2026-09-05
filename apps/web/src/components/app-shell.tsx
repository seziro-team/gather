import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOutAction } from '@/app/(auth)/actions';
import { Wordmark } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/requests', label: 'Requests' },
  { href: '/clients', label: 'Clients' },
  { href: '/templates', label: 'Templates' },
  { href: '/settings/team', label: 'Team' },
  { href: '/account/security', label: 'Security' },
];

export function AppShell({
  firmName,
  email,
  cloud,
  platformAdmin,
  children,
}: {
  firmName: string;
  email: string;
  /** Adds Billing. False on a self-hosted install, where there is nothing to buy. */
  cloud: boolean;
  /** Adds Admin, for whoever operates the hosted tier. Never true self-hosted. */
  platformAdmin: boolean;
  children: ReactNode;
}) {
  const links = [
    ...NAV,
    ...(cloud ? [{ href: '/settings/billing', label: 'Billing' }] : []),
    ...(platformAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/dashboard" className="text-slate-900">
            <Wordmark />
          </Link>
          <span className="text-sm text-slate-500">{firmName}</span>
          <nav className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-slate-600 hover:text-slate-900"
              >
                {link.label}
              </Link>
            ))}
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
