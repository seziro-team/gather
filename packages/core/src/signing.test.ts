import { describe, expect, it } from 'vitest';
import { expiryIn, signDownload, verifyDownload, type DownloadGrant } from './signing.js';

const SECRET = 'a-signing-secret-long-enough-to-be-real-0123456789';
const NOW = new Date('2026-08-03T12:00:00.000Z');

function grant(overrides: Partial<DownloadGrant> = {}): DownloadGrant {
  return {
    fileId: '3f1c9a2e-0c5b-4f3a-9b2e-7d1a6c8f4e21',
    scope: 'portal:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    expiresAt: expiryIn(300, NOW),
    ...overrides,
  };
}

describe('signed download links', () => {
  it('accepts a link it just signed', () => {
    const g = grant();
    expect(verifyDownload(SECRET, g, signDownload(SECRET, g), NOW)).toEqual({ ok: true });
  });

  it('rejects a link that has run out', () => {
    const g = grant({ expiresAt: expiryIn(300, NOW) });
    const signature = signDownload(SECRET, g);
    const later = new Date(NOW.getTime() + 301_000);
    expect(verifyDownload(SECRET, g, signature, later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a link whose expiry has been pushed out', () => {
    const g = grant();
    const signature = signDownload(SECRET, g);
    const extended = { ...g, expiresAt: g.expiresAt + 86_400 };
    expect(verifyDownload(SECRET, extended, signature, NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('will not let one file’s link open another', () => {
    const g = grant();
    const signature = signDownload(SECRET, g);
    const other = { ...g, fileId: '00000000-0000-4000-8000-000000000000' };
    expect(verifyDownload(SECRET, other, signature, NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('will not let a client’s link be replayed as the firm’s', () => {
    const g = grant();
    const signature = signDownload(SECRET, g);
    const asFirm = { ...g, scope: 'firm:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' };
    expect(verifyDownload(SECRET, asFirm, signature, NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('is worthless to another install', () => {
    const g = grant();
    expect(verifyDownload('a-different-installs-secret', g, signDownload(SECRET, g), NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('rejects a malformed signature without throwing', () => {
    const g = grant();
    for (const bad of ['', 'nope', 'ZZ'.repeat(32), signDownload(SECRET, g).slice(0, 63)]) {
      expect(verifyDownload(SECRET, g, bad, NOW)).toEqual({ ok: false, reason: 'malformed' });
    }
    expect(verifyDownload(SECRET, grant({ expiresAt: Number.NaN }), 'a'.repeat(64), NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('checks the signature before the clock, so expiry cannot be probed', () => {
    const g = grant({ expiresAt: expiryIn(-3600, NOW) });
    // Signature wrong *and* expired: the answer must be the one that reveals nothing.
    expect(verifyDownload(SECRET, g, 'f'.repeat(64), NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });
});
