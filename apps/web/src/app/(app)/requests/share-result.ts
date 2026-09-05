/**
 * Return shapes for the sharing and download actions on a request.
 *
 * In their own module because a `'use server'` file may export nothing but async functions.
 */

export type NewLinkResult =
  { ok: true; url: string; expiresAt: string } | { ok: false; error: string };

export type LinkActionResult = { ok: true } | { ok: false; error: string };

export type FirmDownloadResult = { ok: true; url: string } | { ok: false; error: string };

export type ScheduleResult =
  { ok: true; nextRunAt: string | null; description: string } | { ok: false; error: string };

export type SendNowResult = { ok: true } | { ok: false; error: string };

export type CompleteResult = { ok: true } | { ok: false; error: string };

export type ReviewActionResult =
  | { ok: true; status: 'approved' | 'rejected'; completed: boolean; requiredRemaining: number }
  | { ok: false; error: string };
