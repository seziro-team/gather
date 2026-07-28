import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Card, Field, Input } from '@/components/ui';
import { isSignupAllowed } from '@/lib/auth';
import { getSessionUser } from '@/lib/session';
import { signInAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in · Gather' };

export default async function SignInPage() {
  if (await getSessionUser()) redirect('/dashboard');
  const canSignUp = await isSignupAllowed();

  return (
    <Card>
      <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        Your firm’s side of Gather. Clients never sign in — they get a link.
      </p>

      <ActionForm action={signInAction} submitLabel="Sign in" pendingLabel="Signing in…">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
      </ActionForm>

      {canSignUp ? (
        <p className="mt-6 text-sm text-slate-600">
          No account on this install yet?{' '}
          <Link href="/sign-up" className="text-brand-700 font-medium underline">
            Claim it
          </Link>
          .
        </p>
      ) : null}
    </Card>
  );
}
