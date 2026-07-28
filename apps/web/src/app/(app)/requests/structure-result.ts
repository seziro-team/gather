import type { TemplateBody } from '@gather/core';

/**
 * What `saveRequestStructureAction` returns.
 *
 * Kept out of the `'use server'` module because such a file may only export async
 * functions — a type or a constant alongside them is a build error.
 */
export type SaveStructureResult = { ok: true; body: TemplateBody } | { ok: false; error: string };
