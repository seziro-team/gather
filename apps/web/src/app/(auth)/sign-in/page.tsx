import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { SsoButton } from '@/components/sso-button';
import { Card, Field, Input } from '@/components/ui';
import { isSignupAllowed, passwordsEnabled, ssoEnabled, ssoProviderName } from '@/lib/auth';
import { safeNext } from '@/lib/next-path';
import { getSessionUser } from '@/lib/session';
import { signInAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in · Gather' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // `next` survives the round trip so an invitation link still works for somebody who
  // already has an account: they sign in, and land back on /join/<token>.
  const next = safeNext((await searchParams).next);
  if (await getSessionUser()) redirect(next);

  const sso = ssoEnabled();
  const passwords = passwordsEnabled();
  const canSignUp = passwords && (await isSignupAllowed());

  return (
    <Card>
      <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        Your firm’s side of Gather. Clients never sign in — they get a link.
      </p>

      {sso ? <SsoButton providerName={ssoProviderName()} next={next} /> : null}

      {sso && passwords ? (
        <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      ) : null}

      {passwords ? (
        <ActionForm action={signInAction} submitLabel="Sign in" pendingLabel="Signing in…">
          <input type="hidden" name="next" value={next} />
          <Field label="Email">
            <Input name="email" type="email" autoComplete="username" required autoFocus={!sso} />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
        </ActionForm>
      ) : (
        <p className="mt-4 text-sm text-slate-600">
          This install signs in through {ssoProviderName()}. There is no Gather password to forget,
          and an account disabled there cannot get in here either.
        </p>
      )}

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
