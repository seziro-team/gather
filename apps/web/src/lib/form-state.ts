/**
 * Shared shape for `useActionState` forms.
 *
 * Lives outside the `'use server'` modules on purpose: a server-action file may only
 * export async functions, so constants and types have to sit somewhere else.
 */
export interface FormState {
  error: string | null;
}

export const EMPTY_FORM_STATE: FormState = { error: null };
