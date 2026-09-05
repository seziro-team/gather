/**
 * Return shapes for the sharing and download actions on a request.
 *
 * In their own module because a `'use server'` file may export nothing but async functions.
 */

export type NewLinkResult =
  { ok: true; url: string; expiresAt: string } | { ok: false; error: string };

export type LinkActionResult = { ok: true } | { ok: false; error: string };

export type FirmDownloadResult = { ok: true; url: string } | { ok: false; error: string };
