import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Card, Field, Input } from '@/components/ui';
import { verifyBackupCodeAction, verifyTotpAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Two-factor code · Gather' };

export default function TwoFactorPage() {
  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-xl font-semibold text-slate-900">Enter your code</h1>
        <p className="mt-1 mb-6 text-sm text-slate-600">
          Open your authenticator app and type the current 6-digit code for Gather.
        </p>

        <ActionForm action={verifyTotpAction} submitLabel="Verify" pendingLabel="Checking…">
          <Field label="6-digit code">
            <Input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              className="text-center text-2xl tracking-[0.4em]"
            />
          </Field>
        </ActionForm>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-slate-900">Lost your phone?</h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          Use one of the backup codes you saved when you turned two-factor on. Each works once.
        </p>
        <ActionForm
          action={verifyBackupCodeAction}
          submitLabel="Use backup code"
          pendingLabel="Checking…"
          variant="secondary"
        >
          <Field label="Backup code">
            <Input name="code" autoComplete="one-time-code" required className="font-mono" />
          </Field>
        </ActionForm>
      </Card>

      <p className="text-center text-sm text-slate-600">
        <Link href="/sign-in" className="text-brand-700 font-medium underline">
          Start over
        </Link>
      </p>
    </div>
  );
}
