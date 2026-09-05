import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    // Loads .env so `pnpm test` works against a running `docker compose up`. Real
    // environment variables still win, so CI is unaffected.
    setupFiles: ['./vitest.setup.ts'],
    // Integration tests share one Postgres database; running files in parallel would
    // have them truncating each other's rows mid-assertion.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
