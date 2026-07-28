import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Alert, Card, Field, Input } from '@/components/ui';
import { isSignupAllowed } from '@/lib/auth';
import { getSessionUser } from '@/lib/session';
import { signUpAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Create your account · Gather' };

export default async function SignUpPage() {
  if (await getSessionUser()) redirect('/dashboard');

  if (!(await isSignupAllowed())) {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-slate-900">Sign-ups are closed</h1>
        <div className="mt-4">
          <Alert tone="info">
            This Gather install is already claimed. Ask whoever runs it to invite you, or set
            <code className="mx-1 rounded bg-slate-200 px-1 py-0.5 text-xs">
              GATHER_ALLOW_SIGNUP=open
            </code>
            in the environment to reopen sign-ups.
          </Alert>
        </div>
        <p className="mt-6 text-sm text-slate-600">
          <Link href="/sign-in" className="text-brand-700 font-medium underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold text-slate-900">Claim this install</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        You’re the first account here, so you become the owner. Sign-ups close behind you.
      </p>

      <ActionForm action={signUpAction} submitLabel="Create account" pendingLabel="Creating…">
        <Field label="Your name">
          <Input name="name" autoComplete="name" required autoFocus />
        </Field>
        <Field label="Firm name" hint="Clients see this on every request you send.">
          <Input name="firmName" autoComplete="organization" required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" hint="At least 12 characters. A passphrase is fine.">
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
          />
        </Field>
      </ActionForm>

      <p className="mt-6 text-sm text-slate-600">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-brand-700 font-medium underline">
          Sign in
        </Link>
        .
      </p>
    </Card>
  );
}
