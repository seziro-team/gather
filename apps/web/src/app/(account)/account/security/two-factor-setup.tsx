'use client';

import { useActionState } from 'react';
import Image from 'next/image';
import { Alert, Button, Field, Input } from '@/components/ui';
import { confirmTwoFactorSetup, startTwoFactorSetup } from './actions';
import { EMPTY_SETUP_STATE } from './state';

/**
 * Two-step TOTP enrolment. The shared secret only ever exists in this response — it is
 * not stashed in a cookie or in the URL, so a leaked link cannot reveal it.
 */
export function TwoFactorSetup() {
  const [startState, startAction, starting] = useActionState(
    startTwoFactorSetup,
    EMPTY_SETUP_STATE,
  );
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmTwoFactorSetup,
    EMPTY_SETUP_STATE,
  );

  const enrolment = startState.enrolment;

  if (!enrolment) {
    return (
      <form action={startAction} className="space-y-4">
        {startState.error ? <Alert tone="error">{startState.error}</Alert> : null}
        <Field label="Your password" hint="Confirms it’s you before a new second factor is issued.">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" disabled={starting}>
          {starting ? 'Preparing…' : 'Set up authenticator app'}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <Image
          src={enrolment.qrDataUrl}
          alt="QR code for your authenticator app"
          width={232}
          height={232}
          unoptimized
          className="shrink-0 rounded-lg ring-1 ring-slate-200"
        />
        <div className="min-w-0 space-y-3 text-sm text-slate-700">
          <p>
            Scan this with any authenticator app — 1Password, Google Authenticator, Aegis,
            Bitwarden.
          </p>
          <div>
            <p className="font-medium text-slate-900">Or enter this key by hand</p>
            <code
              data-testid="totp-secret"
              className="mt-1 block rounded bg-slate-100 p-2 font-mono text-xs break-all"
            >
              {enrolment.secret}
            </code>
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200">
        <p className="text-sm font-semibold text-amber-900">
          Save these backup codes now — they are shown once
        </p>
        <p className="mt-1 text-sm text-amber-900">
          Each one signs you in a single time if you lose your phone.
        </p>
        <ul
          data-testid="backup-codes"
          className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-amber-950 sm:grid-cols-3"
        >
          {enrolment.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>

      <form action={confirmAction} className="space-y-4">
        {confirmState.error ? <Alert tone="error">{confirmState.error}</Alert> : null}
        <Field label="Enter the current 6-digit code to finish">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            className="max-w-40 text-center text-2xl tracking-[0.3em]"
          />
        </Field>
        <Button type="submit" disabled={confirming}>
          {confirming ? 'Checking…' : 'Turn on two-factor'}
        </Button>
      </form>
    </div>
  );
}
