/**
 * Return shapes for the settings actions.
 *
 * In their own module because a `'use server'` file may export nothing but async functions.
 */

export type TeamActionResult = { ok: true } | { ok: false; error: string };

export type InviteResult =
  { ok: true; url: string; emailed: boolean } | { ok: false; error: string };

export type BillingRedirect = { ok: true; url: string } | { ok: false; error: string };
