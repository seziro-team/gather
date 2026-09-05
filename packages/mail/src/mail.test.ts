import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { domainOf, formatAddress } from './message.js';
import { ResendMail } from './resend.js';
import {
  renderReminderEmail,
  renderRequestEmail,
  renderTestEmail,
  type ReminderContent,
} from './templates.js';
import { shouldReplaceStatus, statusForEvent, verifyWebhook } from './webhook.js';

const brand = { firmName: 'Delgado & Co', color: '#7c3aed', logoUrl: null };

const content: ReminderContent = {
  brand,
  clientName: 'Rosa Delgado',
  requestTitle: '2025 tax return documents',
  portalUrl: 'https://gather.example/p/abc123',
  outstanding: ['Form W-2', 'Mortgage interest statement (1098)', 'Charitable donation receipts'],
  totalItems: 8,
  dueAt: new Date('2026-04-10T23:59:59.999Z'),
  reminderNumber: 2,
};

describe('addresses', () => {
  it('quotes a display name only when it has to', () => {
    expect(formatAddress('Delgado Bookkeeping', 'a@b.com')).toBe('Delgado Bookkeeping <a@b.com>');
    expect(formatAddress('Delgado, Ruiz & Co', 'a@b.com')).toBe('"Delgado, Ruiz & Co" <a@b.com>');
    expect(formatAddress('He said "hi"', 'a@b.com')).toBe('"He said \\"hi\\"" <a@b.com>');
    expect(formatAddress('   ', 'a@b.com')).toBe('a@b.com');
  });

  it('finds the domain in both forms an address is written', () => {
    expect(domainOf('documents@Delgado.Example')).toBe('delgado.example');
    expect(domainOf('Delgado <documents@delgado.example>')).toBe('delgado.example');
    expect(() => domainOf('not-an-address')).toThrow(/not an email address/);
  });
});

describe('reminder emails', () => {
  it('leads with what is left, and says how much is already in', () => {
    const email = renderReminderEmail(content);

    expect(email.subject).toBe('3 things left: 2025 tax return documents');
    expect(email.text).toContain('5 of 8 items are in');
    expect(email.html).toContain('Form W-2');
    expect(email.text).toContain('- Form W-2');
    // Stored as end-of-day UTC and read back in UTC, so the client sees the day the firm
    // typed — not the day before it, which is what a local-timezone render would show.
    expect(email.html).toContain('10 April 2026');
    expect(email.text).toContain('10 April 2026');
  });

  it('changes the subject when only one item is left', () => {
    const email = renderReminderEmail({ ...content, outstanding: ['Form W-2'] });
    expect(email.subject).toBe('One thing left: 2025 tax return documents');
    expect(email.html).toContain('Send the last one');
  });

  it('does not thank a client who has sent nothing yet', () => {
    const email = renderReminderEmail({
      ...content,
      outstanding: Array.from({ length: 8 }, (_, i) => `Item ${i + 1}`),
    });
    expect(email.text).not.toContain('Thank you');
    expect(email.text).toContain('Just a nudge');
  });

  it('counts the tail rather than listing twenty items', () => {
    const email = renderReminderEmail({
      ...content,
      totalItems: 25,
      outstanding: Array.from({ length: 25 }, (_, i) => `Item ${i + 1}`),
    });
    expect(email.html).toContain('Item 8');
    expect(email.html).not.toContain('Item 9<');
    expect(email.html).toContain('and 17 more');
  });

  it('escapes anything a firm or a client typed', () => {
    const email = renderReminderEmail({
      ...content,
      brand: { ...brand, firmName: 'Ruiz <script>alert(1)</script>' },
      clientName: 'Ann "The Boss" O\'Neill',
      outstanding: ['Receipt for <b>everything</b>'],
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Receipt for &lt;b&gt;everything&lt;/b&gt;');
  });

  it('refuses to interpolate a colour that is not a colour', () => {
    const email = renderReminderEmail({
      ...content,
      brand: { ...brand, color: 'red;}</style><script>alert(1)</script>' },
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('#0f766e');
  });

  it('always ships a real text alternative', () => {
    for (const email of [
      renderRequestEmail(content),
      renderReminderEmail(content),
      renderTestEmail(brand, 'https://gather.example'),
    ]) {
      expect(email.text.length).toBeGreaterThan(80);
      expect(email.text).not.toContain('<');
      expect(email.subject).not.toBe('');
    }
  });

  it('calls the first email a request rather than a reminder', () => {
    const email = renderRequestEmail(content);
    expect(email.subject).toBe('Delgado & Co: 2025 tax return documents');
    expect(email.text).toContain('no account to create');
    expect(email.text).not.toMatch(/reminder|nudge/i);
  });
});

describe('webhook verification', () => {
  const secret = 'whsec_' + Buffer.from('a-shared-secret-of-some-length').toString('base64');
  const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'abc' } });
  const id = 'msg_2abc';

  function sign(at: Date, rawBody = body, key = secret): string {
    const seconds = Math.floor(at.getTime() / 1000);
    const bytes = Buffer.from(key.slice('whsec_'.length), 'base64');
    const mac = createHmac('sha256', bytes).update(`${id}.${seconds}.${rawBody}`).digest('base64');
    return `v1,${mac}`;
  }

  const now = new Date('2026-09-05T10:00:00Z');
  const headers = (signature: string, at: Date = now) => ({
    id,
    timestamp: String(Math.floor(at.getTime() / 1000)),
    signature,
  });

  it('accepts a correctly signed payload', () => {
    expect(verifyWebhook(secret, headers(sign(now)), body, now)).toEqual({ ok: true });
  });

  it('accepts a secret written without the whsec_ prefix', () => {
    const bare = secret.slice('whsec_'.length);
    expect(verifyWebhook(bare, headers(sign(now)), body, now)).toEqual({ ok: true });
  });

  it('rejects a body that changed by one byte', () => {
    const tampered = body.replace('email.bounced', 'email.deliver');
    expect(verifyWebhook(secret, headers(sign(now)), tampered, now)).toEqual({
      ok: false,
      reason: 'no-matching-signature',
    });
  });

  it('rejects a signature made with a different secret', () => {
    const other = 'whsec_' + Buffer.from('a-completely-different-secret').toString('base64');
    expect(verifyWebhook(secret, headers(sign(now, body, other)), body, now)).toEqual({
      ok: false,
      reason: 'no-matching-signature',
    });
  });

  it('rejects a replay from outside the tolerance window', () => {
    const old = new Date(now.getTime() - 10 * 60_000);
    expect(verifyWebhook(secret, headers(sign(old), old), body, now)).toEqual({
      ok: false,
      reason: 'timestamp-out-of-tolerance',
    });
  });

  it('rejects a request with no signature headers at all', () => {
    expect(
      verifyWebhook(secret, { id: null, timestamp: null, signature: null }, body, now),
    ).toEqual({ ok: false, reason: 'missing-headers' });
  });

  it('accepts when one of several signatures matches, as during a rotation', () => {
    const combined = `v1,${Buffer.from('nonsense').toString('base64')} ${sign(now)}`;
    expect(verifyWebhook(secret, headers(combined), body, now)).toEqual({ ok: true });
  });
});

describe('webhook event mapping', () => {
  it('maps the events Gather subscribes to, and ignores the rest', () => {
    expect(statusForEvent('email.delivered')).toBe('delivered');
    expect(statusForEvent('email.bounced')).toBe('bounced');
    expect(statusForEvent('email.complained')).toBe('complained');
    // Open and click tracking is deliberately not subscribed to.
    expect(statusForEvent('email.opened')).toBeNull();
    expect(statusForEvent('email.clicked')).toBeNull();
  });

  it('never lets a late event undo an outcome', () => {
    // Resend does not promise ordering, and "bounced" is what the firm needs to see.
    expect(shouldReplaceStatus('queued', 'sent')).toBe(true);
    expect(shouldReplaceStatus('sent', 'delivered')).toBe(true);
    expect(shouldReplaceStatus('bounced', 'sent')).toBe(false);
    expect(shouldReplaceStatus('bounced', 'delivered')).toBe(false);
    expect(shouldReplaceStatus('complained', 'bounced')).toBe(false);
  });
});

describe('the Resend driver', () => {
  /** A stand-in for the endpoint, so the request Gather builds can be inspected. */
  function capture(status: number, payload: unknown) {
    const seen: { url?: string; init?: RequestInit } = {};
    const server = async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.init = init;
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    };
    return { seen, server };
  }

  const message = {
    to: 'rosa@example.com',
    subject: 'Test',
    html: '<p>hi</p>',
    text: 'hi',
    idempotencyKey: 'reminder-1',
  };

  it('sends what Resend documents, and returns the id', async () => {
    const { seen, server } = capture(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
    const original = globalThis.fetch;
    globalThis.fetch = server as unknown as typeof fetch;

    try {
      const driver = new ResendMail({ apiKey: 're_test', from: 'Firm <a@b.com>' });
      const sent = await driver.send(message);

      expect(sent.providerMessageId).toBe('49a3999c-0ce1-4ea6-ab68-afcd6dc2e794');
      expect(seen.url).toBe('https://api.resend.com/emails');

      const headers = seen.init!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer re_test');
      expect(headers['Idempotency-Key']).toBe('reminder-1');

      const body = JSON.parse(seen.init!.body as string);
      expect(body).toMatchObject({
        from: 'Firm <a@b.com>',
        to: ['rosa@example.com'],
        subject: 'Test',
        html: '<p>hi</p>',
        text: 'hi',
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('knows which failures are worth retrying', async () => {
    const cases: [number, boolean, RegExp][] = [
      [429, true, /rate limit/i],
      [500, true, /500/],
      [401, false, /RESEND_API_KEY/],
      [422, false, /has not been verified/],
    ];

    const original = globalThis.fetch;
    try {
      for (const [status, retryable, message_] of cases) {
        const { server } = capture(status, { message: 'nope' });
        globalThis.fetch = server as unknown as typeof fetch;
        const driver = new ResendMail({ apiKey: 're_test', from: 'a@b.com' });

        await expect(driver.send(message)).rejects.toMatchObject({ retryable });
        await expect(driver.send(message)).rejects.toThrow(message_);
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  it('treats an unreachable endpoint as retryable', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as typeof fetch;
    try {
      const driver = new ResendMail({ apiKey: 're_test', from: 'a@b.com' });
      await expect(driver.send(message)).rejects.toMatchObject({ retryable: true });
    } finally {
      globalThis.fetch = original;
    }
  });
});
