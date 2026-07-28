'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentActor } from '@/lib/actor';
import { createClient, setClientArchived, updateClient } from '@/lib/clients';
import type { FormState } from '@/lib/form-state';

const clientSchema = z.object({
  name: z.string().trim().min(1, 'Enter the client’s name.').max(200),
  email: z.email('Enter a valid email address — this is where their link will be sent.'),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(200).optional(),
});

function readForm(formData: FormData) {
  return clientSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone') || undefined,
    company: formData.get('company') || undefined,
  });
}

export async function createClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = readForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const actor = await currentActor();
  try {
    await createClient(actor, parsed.data);
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath('/clients');
  redirect('/clients');
}

export async function updateClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = z.uuid().safeParse(formData.get('id'));
  const parsed = readForm(formData);
  if (!id.success) return { error: 'That client could not be identified.' };
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const actor = await currentActor();
  try {
    await updateClient(actor, id.data, parsed.data);
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath('/clients');
  redirect('/clients');
}

export async function setClientArchivedAction(formData: FormData): Promise<void> {
  const id = z.uuid().parse(formData.get('id'));
  const archived = formData.get('archived') === 'true';

  const actor = await currentActor();
  await setClientArchived(actor, id, archived);

  revalidatePath('/clients');
  revalidatePath(`/clients/${id}`);
  redirect('/clients');
}
