'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { disableTwoFactor } from './actions';
import { EMPTY_DISABLE_STATE } from './state';

export function DisableTwoFactor() {
  const [state, action, pending] = useActionState(disableTwoFactor, EMPTY_DISABLE_STATE);

  return (
    <form action={action} className="max-w-sm space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field label="Your password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? 'Turning off…' : 'Turn off two-factor'}
      </Button>
    </form>
  );
}
