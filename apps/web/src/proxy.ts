import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers, with a real Content-Security-Policy.
 *
 * In `proxy.ts` rather than `next.config.ts` for one reason: the policy carries a
 * per-request nonce, and a static config cannot generate one. (Next 16 renamed
 * `middleware.ts` to `proxy.ts`; this is that file.)
 *
 * The nonce is what makes `'strict-dynamic'` possible. Next injects inline bootstrap
 * scripts, so the alternative is `'unsafe-inline'` — which is to say, no script policy at
 * all. Gather renders a firm's own branding and a client's own filenames into pages that
 * also hold tax documents; a policy that would not stop an injected script is not worth
 * the header.
 *
 * Uploaded files are served with their own, far stricter policy — `default-src 'none';
 * sandbox` — from `fileResponse` in lib/files.ts, and always as an attachment. Nothing a
 * client uploads is ever rendered in Gather's origin.
 */

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isHttps = request.nextUrl.protocol === 'https:';

  const policy = [
    `default-src 'self'`,
    // `strict-dynamic` lets the nonced bootstrap load the chunks it needs, and nothing
    // else. The http:/https: entries are ignored by browsers that understand
    // strict-dynamic and act as the fallback for those that do not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: http:`,
    // Tailwind emits a stylesheet, but the portal sets a firm's brand colour through
    // inline custom properties on a wrapper element — so style-src has to allow inline.
    // The values are matched against /^#[0-9a-f]{3,8}$/i before they get there.
    `style-src 'self' 'unsafe-inline'`,
    // A firm's logo may be hosted anywhere; `data:` covers the QR code on the two-factor
    // setup page, which is generated in-process and never fetched.
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    // Same-origin only. Gather talks to nothing else from the browser — every third-party
    // call (Resend, S3, clamd) happens server-side.
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const headers = new Headers(request.headers);
  // Read back by the app so server components can attach the nonce to any script they add.
  headers.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers } });

  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Gather needs none of these. Denying them means a compromised dependency cannot ask.
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  // Only over HTTPS. Sending HSTS on a plain-HTTP install would pin a browser to a scheme
  // that install does not serve — and a self-hoster running Gather on a LAN address would
  // be locked out of their own tool with no way to undo it.
  if (isHttps) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Pages, and only pages.
     *
     * Two groups are excluded, for different reasons.
     *
     * Next's own static output and the favicon are immutable build artefacts on the same
     * origin; running them through this adds latency to every asset and protects nothing.
     *
     * **Everything that serves an uploaded file or an export is excluded because this
     * policy is weaker than theirs.** `fileResponse` sends `default-src 'none'; sandbox`,
     * which is the whole defence against an uploaded file executing; the page policy here
     * allows `'self'`, and a proxy that overwrites the stricter one with the looser one
     * would silently undo it. That is not hypothetical — it is exactly what happened when
     * this file was added, and `e2e/security.spec.ts` ⑥ is what caught it.
     */
    {
      source:
        '/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|api/file/|audit$|.*/file/|.*/download$|.*/audit\\.csv$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
