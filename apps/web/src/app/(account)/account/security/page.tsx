import { env } from '@gather/core';
import { Alert, Card } from '@/components/ui';
import { requireMembership } from '@/lib/session';
import { DisableTwoFactor } from './disable-two-factor';
import { TwoFactorSetup } from './two-factor-setup';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Security · Gather' };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireMembership();
  const params = await searchParams;
  const required = env().GATHER_REQUIRE_2FA;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Security</h1>
        <p className="mt-1 text-sm text-slate-600">
          Gather holds tax documents. Two-factor authentication is one of the controls the FTC
          Safeguards Rule expects in front of them (16 CFR 314.4(c)(5)).
        </p>
      </div>

      {params.welcome && !user.twoFactorEnabled ? (
        <Alert tone="success" title="Account created">
          One thing left: set up your authenticator app.
        </Alert>
      ) : null}

      {params.required && !user.twoFactorEnabled ? (
        <Alert tone="warning" title="Two-factor is required on this install">
          Finish setting it up to reach the dashboard. To turn the requirement off, set
          <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 text-xs">
            GATHER_REQUIRE_2FA=false
          </code>
          in the environment.
        </Alert>
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold text-slate-900">Authenticator app (TOTP)</h2>
        <p className="mt-1 mb-5 text-sm text-slate-600">
          {user.twoFactorEnabled
            ? 'Two-factor authentication is on for your account.'
            : 'A 6-digit code from your phone, required every time you sign in.'}
        </p>

        {user.twoFactorEnabled ? (
          required ? (
            <Alert tone="info">
              This install requires two-factor authentication, so it cannot be turned off here.
            </Alert>
          ) : (
            <DisableTwoFactor />
          )
        ) : (
          <TwoFactorSetup />
        )}
      </Card>
    </div>
  );
}
