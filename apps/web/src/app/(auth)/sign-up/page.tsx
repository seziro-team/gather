import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ROLE_LABELS } from '@gather/core';
import { ActionForm } from '@/components/action-form';
import { Alert, Card, Field, Input } from '@/components/ui';
import { isSignupAllowed } from '@/lib/auth';
import { getSessionUser } from '@/lib/session';
import { lookupInvite } from '@/lib/team';
import { signUpAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Create your account · Gather' };

/**
 * Two pages in one, decided by `?invite=`.
 *
 * Claiming the install asks for a firm name; accepting an invitation does not, because the
 * firm already exists and its name is shown instead. An invitation also gets past closed
 * sign-ups — an install that has been claimed still has to be able to add a colleague, and
 * that is checked again in the action rather than trusted from the query string.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (await getSessionUser()) redirect('/dashboard');

  const { invite: token } = await searchParams;
  const invite = token ? await lookupInvite(token) : null;

  if (token && invite && !invite.ok) {
    redirect(
      `/join/unavailable?reason=${invite.reason === 'unknown' ? 'not-found' : invite.reason}`,
    );
  }

  const invited = invite?.ok ? invite : null;

  if (!invited && !(await isSignupAllowed())) {
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
      <h1 className="text-xl font-semibold text-slate-900">
        {invited ? `Join ${invited.firmName}` : 'Claim this install'}
      </h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        {invited
          ? `You’ve been invited as ${ROLE_LABELS[invited.invite.role].toLowerCase()}. Set a password and you’re in.`
          : 'You’re the first account here, so you become the owner. Sign-ups close behind you.'}
      </p>

      <ActionForm
        action={signUpAction}
        submitLabel={invited ? 'Join the firm' : 'Create account'}
        pendingLabel={invited ? 'Joining…' : 'Creating…'}
      >
        {invited ? <input type="hidden" name="invite" value={token} /> : null}

        <Field label="Your name">
          <Input name="name" autoComplete="name" required autoFocus />
        </Field>

        {invited ? null : (
          <Field label="Firm name" hint="Clients see this on every request you send.">
            <Input name="firmName" autoComplete="organization" required />
          </Field>
        )}

        <Field label="Email" hint={invited ? 'The address the invitation was sent to.' : undefined}>
          <Input
            name="email"
            type="email"
            autoComplete="username"
            required
            defaultValue={invited?.invite.email}
            readOnly={Boolean(invited)}
            className={invited ? 'bg-slate-50 text-slate-600' : undefined}
          />
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
        <Link
          href={token ? `/sign-in?next=${encodeURIComponent(`/join/${token}`)}` : '/sign-in'}
          className="text-brand-700 font-medium underline"
        >
          Sign in
        </Link>
        .
      </p>
    </Card>
  );
}
