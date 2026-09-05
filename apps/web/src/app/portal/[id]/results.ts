import type { ResponseValue } from '@gather/core';

/**
 * Return shapes for the portal's server actions.
 *
 * Separate from `actions.ts` because a `'use server'` module may only export async
 * functions — a type exported alongside them is a build error.
 */

export type SaveAnswerResult = { ok: true; value: ResponseValue } | { ok: false; error: string };

export type PortalActionResult = { ok: true } | { ok: false; error: string };

export type DownloadLinkResult = { ok: true; url: string } | { ok: false; error: string };
