import { execFileSync } from 'node:child_process';

/**
 * Generates TOTP codes with GNU oathtool — the reference implementation of RFC 6238,
 * and the same algorithm every authenticator app runs.
 *
 * Using an outside tool rather than Better Auth's own code is the point: it proves the
 * server accepts codes from a real authenticator, not merely codes produced by the same
 * library that checks them.
 */
export function totp(secret: string): string {
  try {
    return execFileSync('oathtool', ['--totp', '--base32', secret], { encoding: 'utf8' }).trim();
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      throw new Error(
        'oathtool is not installed. Install it (apt-get install oathtool / brew install oath-toolkit) to run the two-factor end-to-end test.',
        { cause: error },
      );
    }
    throw error;
  }
}

/** The 30-second window the current code belongs to. */
export function totpStep(at: number = Date.now()): number {
  return Math.floor(at / 30_000);
}

/**
 * Waits until the next TOTP window if `usedStep` is still current, so a second code is
 * genuinely different. Reusing a code inside its window is a replay, and Gather is
 * expected to reject it.
 */
export async function waitForFreshTotpWindow(usedStep: number): Promise<void> {
  while (totpStep() === usedStep) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
