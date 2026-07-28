'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { env } from '@gather/core';
import { getAuth } from '@/lib/auth';
import { createFirmForUser } from '@/lib/firm';
import { requestContext } from '@/lib/request-context';
import type { FormState } from '@/lib/form-state';

/** Better Auth throws APIError; surface its message and nothing else. */
function messageOf(error: unknown, fallback: string): string {
  const body = (error as { body?: { message?: string } }).body;
  if (body?.message) return body.message;
  const message = (error as { message?: string }).message;
  return message && message !== 'Failed to fetch' ? message : fallback;
}

const signInSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  let needsSecondFactor: boolean;
  try {
    const result = await getAuth().api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
    needsSecondFactor = (result as { twoFactorRedirect?: boolean }).twoFactorRedirect === true;
  } catch (error) {
    return { error: messageOf(error, 'That email and password did not match.') };
  }

  redirect(needsSecondFactor ? '/two-factor' : '/dashboard');
}

const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  firmName: z.string().trim().min(1, 'Enter your firm’s name.').max(120),
  email: z.email('Enter a valid email address.'),
  password: z.string().min(12, 'Use at least 12 characters — length beats complexity.').max(256),
});

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get('name'),
    firmName: formData.get('firmName'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  let userId: string;
  try {
    const result = await getAuth().api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      },
      headers: await headers(),
    });
    userId = result.user.id;
  } catch (error) {
    return { error: messageOf(error, 'Could not create that account.') };
  }

  try {
    await createFirmForUser({
      userId,
      name: parsed.data.firmName,
      context: await requestContext(),
    });
  } catch (error) {
    // The account exists but has no firm. Signing in again lands on /create-firm, so the
    // person is never stranded — but say so rather than pretending everything worked.
    return {
      error: `Your account was created, but the firm could not be: ${
        (error as Error).message
      }. Sign in to finish setting it up.`,
    };
  }

  redirect(env().GATHER_REQUIRE_2FA ? '/account/security?welcome=1' : '/dashboard');
}

const totpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
});

export async function verifyTotpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = totpSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a 6-digit code.' };
  }

  try {
    await getAuth().api.verifyTOTP({
      body: { code: parsed.data.code },
      headers: await headers(),
    });
  } catch (error) {
    return {
      error: messageOf(error, 'That code was not accepted. Codes expire every 30 seconds.'),
    };
  }

  redirect('/dashboard');
}

const backupCodeSchema = z.object({
  code: z.string().trim().min(6, 'Enter one of your backup codes.'),
});

export async function verifyBackupCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = backupCodeSchema.safeParse({ code: formData.get('code') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a backup code.' };
  }

  try {
    await getAuth().api.verifyBackupCode({
      body: { code: parsed.data.code },
      headers: await headers(),
    });
  } catch (error) {
    return { error: messageOf(error, 'That backup code was not accepted.') };
  }

  redirect('/dashboard');
}

const createFirmSchema = z.object({
  firmName: z.string().trim().min(1, 'Enter your firm’s name.').max(120),
});

export async function createFirmAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createFirmSchema.safeParse({ firmName: formData.get('firmName') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a firm name.' };
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  try {
    await createFirmForUser({
      userId: session.user.id,
      name: parsed.data.firmName,
      context: await requestContext(),
    });
  } catch (error) {
    return { error: messageOf(error, 'Could not create the firm.') };
  }

  redirect('/dashboard');
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect('/sign-in');
}
