'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Field, Input, Select, Textarea } from '@/components/ui';
import type { Client } from '@/lib/clients';
import type { TemplateSummary } from '@/lib/templates';
import { createRequestAction } from '../actions';

export function NewRequestForm({
  clients,
  templates,
  initialTemplateId,
}: {
  clients: Pick<Client, 'id' | 'name' | 'email'>[];
  templates: TemplateSummary[];
  initialTemplateId: string;
}) {
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [title, setTitle] = useState(
    templates.find((entry) => entry.id === initialTemplateId)?.name ?? '',
  );
  const [titleEdited, setTitleEdited] = useState(initialTemplateId !== '');

  // Choosing a template fills in the title, until someone types their own. Titles are what
  // the client sees in the email subject, so a blank one is a worse default than the
  // template's name.
  function onTemplateChange(next: string) {
    setTemplateId(next);
    if (titleEdited) return;
    setTitle(templates.find((entry) => entry.id === next)?.name ?? '');
  }

  const builtin = templates.filter((entry) => entry.isBuiltin);
  const own = templates.filter((entry) => !entry.isBuiltin);
  const chosen = templates.find((entry) => entry.id === templateId);

  return (
    <ActionForm action={createRequestAction} submitLabel="Create request" pendingLabel="Creating…">
      <Field label="Client">
        <Select name="clientId" required defaultValue={clients[0]?.id ?? ''}>
          {clients.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} — {entry.email}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Start from"
        hint={
          chosen
            ? `${chosen.sections} sections and ${chosen.items} items will be copied in. Editing them will not change the template.`
            : 'A blank request starts with no sections. You can add them on the next screen.'
        }
      >
        <Select
          name="templateId"
          value={templateId}
          onChange={(event) => onTemplateChange(event.target.value)}
        >
          <option value="">Blank request</option>
          {builtin.length > 0 ? (
            <optgroup label="Included with Gather">
              {builtin.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.items} items)
                </option>
              ))}
            </optgroup>
          ) : null}
          {own.length > 0 ? (
            <optgroup label="Your templates">
              {own.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.items} items)
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
      </Field>

      <Field label="Title" hint="Your client sees this. Be specific: “2026 tax return documents”.">
        <Input
          name="title"
          required
          maxLength={200}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleEdited(true);
          }}
        />
      </Field>

      <Field label="Message to the client (optional)">
        <Textarea name="description" rows={3} maxLength={2000} />
      </Field>

      <Field label="Due date (optional)">
        <Input type="date" name="dueAt" />
      </Field>
    </ActionForm>
  );
}
