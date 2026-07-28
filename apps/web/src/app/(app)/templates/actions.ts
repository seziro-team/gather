'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentActor } from '@/lib/actor';
import { deleteFirmTemplate } from '@/lib/templates';

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  const id = z.uuid().parse(formData.get('id'));
  const actor = await currentActor();

  // Built-ins have `firm_id is null`, so the firm filter inside `deleteFirmTemplate`
  // makes deleting one impossible rather than merely discouraged.
  await deleteFirmTemplate(actor, id);

  revalidatePath('/templates');
  redirect('/templates');
}
