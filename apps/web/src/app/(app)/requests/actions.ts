'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parseTemplateBody, TemplateBodyError, type TemplateBody } from '@gather/core';
import { readRequestStructure, getDb } from '@gather/db';
import { currentActor } from '@/lib/actor';
import { downloadQuery, firmScope, signFileDownload } from '@/lib/files';
import { issuePortalLink, revokePortalLink } from '@/lib/portal';
import {
  completeRequest,
  createRequest,
  deleteRequest,
  getRequest,
  saveRequestStructure,
  updateRequestDetails,
} from '@/lib/requests';
import { saveRequestAsTemplate } from '@/lib/templates';
import type { FormState } from '@/lib/form-state';
import type { SaveStructureResult } from './structure-result';
import { cadenceSchema, describeCadence } from '@gather/core';
import { saveSchedule, sendReminderNow } from '@/lib/reminders';
import type {
  CompleteResult,
  FirmDownloadResult,
  LinkActionResult,
  NewLinkResult,
  ScheduleResult,
  SendNowResult,
} from './share-result';

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

/**
 * Create a portal link and hand it back once.
 *
 * Only the hash is stored, so this is genuinely the only moment the link exists in a form
 * anyone can copy. The UI says as much rather than offering a "show again" button that
 * would have to be a lie.
 */
export async function createPortalLinkAction(requestId: string): Promise<NewLinkResult> {
  if (!z.uuid().safeParse(requestId).success) {
    return { ok: false, error: 'That request could not be identified.' };
  }

  const actor = await currentActor();
  try {
    const link = await issuePortalLink(actor, requestId);
    revalidatePath(`/requests/${requestId}`);
    revalidatePath('/requests');
    return { ok: true, url: link.url, expiresAt: link.expiresAt.toISOString() };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function revokePortalLinkAction(
  requestId: string,
  tokenId: string,
): Promise<LinkActionResult> {
  if (!z.uuid().safeParse(requestId).success || !z.uuid().safeParse(tokenId).success) {
    return { ok: false, error: 'That link could not be identified.' };
  }

  const actor = await currentActor();
  try {
    await revokePortalLink(actor, requestId, tokenId);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}

/** Signed at the moment of the click, so a five-minute link is genuinely five minutes old. */
export async function firmDownloadLinkAction(
  requestId: string,
  fileId: string,
): Promise<FirmDownloadResult> {
  if (!z.uuid().safeParse(requestId).success || !z.uuid().safeParse(fileId).success) {
    return { ok: false, error: 'That file could not be identified.' };
  }

  const actor = await currentActor();
  const owned = await getRequest(actor.firmId, requestId);
  if (!owned) return { ok: false, error: 'Request not found.' };

  const signed = signFileDownload(fileId, firmScope(actor.firmId));
  return {
    ok: true,
    url: `/api/file/${fileId}?request=${requestId}&${downloadQuery(signed)}`,
  };
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

/**
 * Turn a cadence posted from the editor into a schedule.
 *
 * Parsed with the same zod schema the worker uses to read it back out of `jsonb`, so a
 * cadence that saves is a cadence the engine can act on — there is no second, looser
 * definition of what a valid schedule is.
 */
export async function saveScheduleAction(
  requestId: string,
  cadence: unknown,
  active: boolean,
): Promise<ScheduleResult> {
  if (!z.uuid().safeParse(requestId).success) {
    return { ok: false, error: 'That request could not be identified.' };
  }

  const parsed = cadenceSchema.safeParse(cadence);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `${issue.path.join('.') || 'Schedule'} ${issue.message}`
        : 'Check the schedule.',
    };
  }

  const actor = await currentActor();
  try {
    const { nextRunAt } = await saveSchedule(actor, requestId, parsed.data, active);
    revalidatePath(`/requests/${requestId}`);
    return {
      ok: true,
      nextRunAt: nextRunAt?.toISOString() ?? null,
      description: describeCadence(parsed.data),
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function sendReminderNowAction(requestId: string): Promise<SendNowResult> {
  if (!z.uuid().safeParse(requestId).success) {
    return { ok: false, error: 'That request could not be identified.' };
  }

  const actor = await currentActor();
  const result = await sendReminderNow(actor, requestId);
  revalidatePath(`/requests/${requestId}`);
  return result;
}

/**
 * Mark a request complete, which is also what stops the reminders.
 *
 * Phase 5 replaces this with per-item approval driving the same transition; until then it
 * is a deliberate button rather than an inference, because "complete" is the firm's
 * judgement and nothing else should be making it.
 */
export async function completeRequestAction(requestId: string): Promise<CompleteResult> {
  if (!z.uuid().safeParse(requestId).success) {
    return { ok: false, error: 'That request could not be identified.' };
  }

  const actor = await currentActor();
  try {
    await completeRequest(actor, requestId);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}
