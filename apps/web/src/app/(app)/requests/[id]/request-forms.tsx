'use client';

import { ActionForm } from '@/components/action-form';
import { Field, Input, Textarea } from '@/components/ui';
import { saveAsTemplateAction, updateRequestDetailsAction } from '../actions';

/** `<input type="date">` wants `YYYY-MM-DD`, in the value the firm actually stored. */
function dateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export function RequestDetailsForm({
  id,
  title,
  description,
  dueAt,
}: {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
}) {
  return (
    <ActionForm
      action={updateRequestDetailsAction}
      submitLabel="Save details"
      pendingLabel="Saving…"
      variant="secondary"
    >
      <input type="hidden" name="id" value={id} />
      <Field label="Title">
        <Input name="title" required maxLength={200} defaultValue={title} />
      </Field>
      <Field label="Message to the client (optional)">
        <Textarea name="description" rows={3} maxLength={2000} defaultValue={description ?? ''} />
      </Field>
      <Field label="Due date (optional)">
        <Input type="date" name="dueAt" defaultValue={dateInputValue(dueAt)} />
      </Field>
    </ActionForm>
  );
}

export function SaveAsTemplateForm({ id, defaultName }: { id: string; defaultName: string }) {
  return (
    <ActionForm
      action={saveAsTemplateAction}
      submitLabel="Save as template"
      pendingLabel="Saving…"
      variant="secondary"
    >
      <input type="hidden" name="id" value={id} />
      <Field label="Template name">
        <Input name="name" required maxLength={200} defaultValue={defaultName} />
      </Field>
      <Field label="Description (optional)">
        <Input name="description" maxLength={2000} />
      </Field>
    </ActionForm>
  );
}
