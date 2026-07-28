/**
 * Structured JSON logging (one object per line, on stdout) so self-hosters can point
 * any log shipper at the container without parsing prose.
 *
 * Redaction is applied on the way out: Gather handles magic-link tokens, session
 * identifiers and API keys, and none of those may ever reach a log file.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEY = /(token|secret|password|passwd|authorization|cookie|api[-_]?key|dek|session)/i;
export const REDACTED = '[redacted]';

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT_KEY.test(key) ? REDACTED : redact(entry, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  name?: string;
  bindings?: Record<string, unknown>;
  /** Injectable for tests; defaults to writing a line to stdout. */
  write?: (line: string) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const bindings = options.bindings ?? {};
  const threshold = LEVEL_WEIGHT[level];

  const emit = (logLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVEL_WEIGHT[logLevel] < threshold) return;
    const payload = {
      time: new Date().toISOString(),
      level: logLevel,
      ...(options.name ? { name: options.name } : {}),
      ...bindings,
      msg: message,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    write(JSON.stringify(payload));
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (extra) =>
      createLogger({ ...options, bindings: { ...bindings, ...(redact(extra) as object) } }),
  };
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
