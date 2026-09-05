import { createLogger, isLogLevel, type Logger } from '@gather/core';

/**
 * The web app's logger.
 *
 * One per process rather than one per request: Next replaces the module registry on every
 * hot reload, so a module-level `const` would build a new logger on each one. Reading the
 * level from `process.env` directly, rather than through the validated `env()`, keeps this
 * usable from code paths that run before configuration has been parsed.
 */

const globalRef = globalThis as typeof globalThis & { __gatherLogger?: Logger };

function build(): Logger {
  const level = process.env.GATHER_LOG_LEVEL;
  return createLogger({ name: 'gather', level: level && isLogLevel(level) ? level : 'info' });
}

export const logger: Logger = (globalRef.__gatherLogger ??= build());
