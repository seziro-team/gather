import { defineConfig } from 'astro/config';

/**
 * The one-page site.
 *
 * Static output, no adapter, no integrations: it builds to plain files that go anywhere —
 * a bucket, a Pages host, or the same Caddy that serves the app. No domain is hard-coded;
 * `PUBLIC_SITE_URL` and `PUBLIC_APP_URL` come from the environment because which domain
 * this ships on is a decision made after the code is written.
 */
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'https://gather.seziro.com',
  output: 'static',
  build: { inlineStylesheets: 'always' },
  // No web fonts and no third-party scripts anywhere on the page, so there is nothing to
  // preconnect to and nothing that could watch a visitor. Same rule the product follows.
  prefetch: false,
});
