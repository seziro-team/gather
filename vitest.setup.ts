import { readFileSync } from 'node:fs';

/**
 * Make `.env` visible to the integration tests.
 *
 * Without this, `pnpm test` on a laptop where `docker compose up` is already running fails
 * with "no database configured" — the connection string is right there in `.env`, and the
 * test runner is the only part of the stack that could not see it.
 *
 * Real environment variables always win, so CI (which sets `TEST_DATABASE_URL` against its
 * own throwaway Postgres) is unaffected. And `testDatabaseUrl()` still derives a `_test`
 * database from whatever it finds, so loading `.env` here can never point a truncating test
 * at somebody's development data.
 */
for (const line of readEnvFile()) {
  const match = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
  if (!match) continue;

  const [, key, rawValue] = match as unknown as [string, string, string];
  if (process.env[key] !== undefined) continue;

  const value = rawValue.trim();
  const unquoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;

  process.env[key] = unquoted;
}

function readEnvFile(): string[] {
  try {
    return readFileSync(new URL('.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'));
  } catch {
    // No .env is the normal case in CI.
    return [];
  }
}
