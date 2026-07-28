'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parseTemplateBody, TemplateBodyError, type TemplateBody } from '@gather/core';
import { readRequestStructure, getDb } from '@gather/db';
import { currentActor } from '@/lib/actor';
import {
  createRequest,
  deleteRequest,
  getRequest,
  saveRequestStructure,
  updateRequestDetails,
} from '@/lib/requests';
import { saveRequestAsTemplate } from '@/lib/templates';
import type { FormState } from '@/lib/form-state';
import type { SaveStructureResult } from './structure-result';

/** An empty date input posts an empty string; treat that as "no due date". */
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? new Date(`${value}T23:59:59.999Z`) : null))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), {
    message: 'Enter a valid due date.',
  });

const createSchema = z.object({
  clientId: z.uuid('Choose a client.'),
  title: z.string().trim().min(1, 'Give the request a title your client will understand.').max(200),
  description: z.string().trim().max(2000).optional(),
  dueAt: optionalDate,
  templateId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || z.uuid().safeParse(value).success, {
      message: 'Choose a template, or start from blank.',
    }),
});

export async function createRequestAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSchema.safeParse({
    clientId: formData.get('clientId'),
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    dueAt: formData.get('dueAt') || undefined,
    templateId: formData.get('templateId') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const actor = await currentActor();
  let id: string;
  try {
    const created = await createRequest(actor, parsed.data);
    id = created.id;
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath('/requests');
  redirect(`/requests/${id}/edit`);
}

const detailsSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, 'Give the request a title.').max(200),
  description: z.string().trim().max(2000).optional(),
  dueAt: optionalDate,
});

export async function updateRequestDetailsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = detailsSchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    dueAt: formData.get('dueAt') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const actor = await currentActor();
  try {
    await updateRequestDetails(actor, parsed.data.id, parsed.data);
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath(`/requests/${parsed.data.id}`);
  redirect(`/requests/${parsed.data.id}`);
}

/**
 * Saves the whole structure in one call and hands back what was actually stored.
 *
 * The builder replaces its state with the returned body, which is how newly added items
 * pick up their database ids. Without that, the next save would look like "delete
 * everything, insert everything" — losing the row identity that responses hang off.
 */
export async function saveRequestStructureAction(
  requestId: string,
  payload: unknown,
): Promise<SaveStructureResult> {
  if (!z.uuid().safeParse(requestId).success) {
    return { ok: false, error: 'That request could not be identified.' };
  }

  let body: TemplateBody;
  try {
    body = parseTemplateBody(payload);
  } catch (error) {
    if (error instanceof TemplateBodyError) {
      return { ok: false, error: error.issues.join('\n') };
    }
    throw error;
  }

  const actor = await currentActor();
  try {
    await saveRequestStructure(actor, requestId, body);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const saved = await readRequestStructure(getDb(), requestId);
  revalidatePath(`/requests/${requestId}`);
  revalidatePath(`/requests/${requestId}/edit`);
  return { ok: true, body: saved };
}

export async function deleteRequestAction(formData: FormData): Promise<void> {
  const id = z.uuid().parse(formData.get('id'));
  const actor = await currentActor();
  await deleteRequest(actor, id);

  revalidatePath('/requests');
  redirect('/requests');
}

const saveAsTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Give the template a name.').max(200),
  description: z.string().trim().max(2000).optional(),
});

export async function saveAsTemplateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = saveAsTemplateSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    description: formData.get('description') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const actor = await currentActor();
  const owned = await getRequest(actor.firmId, parsed.data.id);
  if (!owned) return { error: 'Request not found.' };

  try {
    await saveRequestAsTemplate(actor, parsed.data.id, parsed.data);
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath('/templates');
  redirect('/templates');
}
