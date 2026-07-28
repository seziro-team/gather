import Link from 'next/link';
import { Wordmark } from '@/components/ui';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 text-lg text-slate-900">
        <Wordmark />
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 text-center text-xs text-slate-500">
        Gather is free and open source, AGPL-3.0. Built in the open by Seziro.
      </p>
    </div>
  );
}
