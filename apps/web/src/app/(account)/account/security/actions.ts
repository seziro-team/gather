'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { z } from 'zod';
import { env } from '@gather/core';
import { getAuth } from '@/lib/auth';
import type { DisableState, SetupState } from './state';

function messageOf(error: unknown, fallback: string): string {
  const body = (error as { body?: { message?: string } }).body;
  return body?.message ?? (error as { message?: string }).message ?? fallback;
}

const passwordSchema = z.object({
  password: z.string().min(1, 'Enter your password to continue.'),
});

/**
 * Step one of enrolment: prove it's really you, then hand back the shared secret.
 * Better Auth stores the secret unverified until a generated code is accepted.
 */
export async function startTwoFactorSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const parsed = passwordSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter your password.', enrolment: null };
  }

  try {
    const result = await getAuth().api.enableTwoFactor({
      body: { password: parsed.data.password, issuer: 'Gather' },
      headers: await headers(),
    });

    const totpUri = result.totpURI;
    const secret = new URL(totpUri).searchParams.get('secret') ?? '';
    const qrDataUrl = await QRCode.toDataURL(totpUri, { margin: 1, width: 232 });

    return {
      error: null,
      enrolment: { qrDataUrl, secret, backupCodes: result.backupCodes },
    };
  } catch (error) {
    return { error: messageOf(error, 'Could not start two-factor setup.'), enrolment: null };
  }
}

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
});

/** Step two: a code generated from the secret proves the app is set up correctly. */
export async function confirmTwoFactorSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const parsed = codeSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a 6-digit code.', enrolment: null };
  }

  try {
    await getAuth().api.verifyTOTP({
      body: { code: parsed.data.code },
      headers: await headers(),
    });
  } catch (error) {
    return {
      error: messageOf(error, 'That code was not accepted. Codes change every 30 seconds.'),
      enrolment: null,
    };
  }

  redirect('/dashboard');
}

export async function disableTwoFactor(
  _prev: DisableState,
  formData: FormData,
): Promise<DisableState> {
  if (env().GATHER_REQUIRE_2FA) {
    return { error: 'This install requires two-factor authentication (GATHER_REQUIRE_2FA=true).' };
  }

  const parsed = passwordSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter your password.' };
  }

  try {
    await getAuth().api.disableTwoFactor({
      body: { password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    return { error: messageOf(error, 'Could not turn two-factor off.') };
  }

  redirect('/account/security');
}
