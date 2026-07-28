import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres database; running files in parallel would
    // have them truncating each other's rows mid-assertion.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
