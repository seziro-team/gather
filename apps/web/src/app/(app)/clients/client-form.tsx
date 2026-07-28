'use client';

import { ActionForm } from '@/components/action-form';
import { Field, Input } from '@/components/ui';
import type { FormState } from '@/lib/form-state';

export interface ClientFormValues {
  id?: string;
  name?: string;
  email?: string;
  phone?: string | null;
  company?: string | null;
}

export function ClientForm({
  action,
  submitLabel,
  values = {},
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  values?: ClientFormValues;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} pendingLabel="Saving…">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Name">
        <Input name="name" required maxLength={200} defaultValue={values.name ?? ''} autoFocus />
      </Field>
      <Field label="Email" hint="Where their request link and every reminder will be sent.">
        <Input type="email" name="email" required defaultValue={values.email ?? ''} />
      </Field>
      <Field label="Company (optional)">
        <Input name="company" maxLength={200} defaultValue={values.company ?? ''} />
      </Field>
      <Field
        label="Phone (optional)"
        hint="Kept on the client record for your own reference. Gather does not send SMS."
      >
        <Input name="phone" maxLength={40} defaultValue={values.phone ?? ''} />
      </Field>
    </ActionForm>
  );
}
