'use client';

import { useActionState, type ReactNode } from 'react';
import { Alert, Button } from './ui';
import { EMPTY_FORM_STATE, type FormState } from '@/lib/form-state';

/**
 * Wraps a server action in a form with pending state and inline error reporting, so no
 * page has to reimplement it. Submit is disabled while the action is in flight — with
 * one-time TOTP codes a double submission is a real failure, not a cosmetic one.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  variant = 'primary',
  children,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {children}
      <Button type="submit" variant={variant} disabled={isPending} className="w-full">
        {isPending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
