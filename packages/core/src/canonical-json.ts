/**
 * Deterministic JSON serialisation.
 *
 * The audit chain hashes structured data that makes a round trip through a Postgres
 * `jsonb` column, and `jsonb` does not preserve key order or insignificant whitespace.
 * Hashing `JSON.stringify(value)` directly would therefore produce a hash that fails to
 * re-verify after a read-back. Everything that goes into a hash preimage is serialised
 * through this function instead: keys sorted lexicographically at every depth, no
 * whitespace, `undefined` treated as absent.
 *
 * Only JSON-safe values are accepted. Anything else (functions, symbols, BigInt, NaN,
 * Infinity, cyclic structures) throws rather than silently producing a value that cannot
 * be reproduced later.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export class CanonicalJsonError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} at ${path || '<root>'}`);
    this.name = 'CanonicalJsonError';
  }
}

function encode(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`Non-finite number (${String(value)})`, path);
      }
      // JSON.stringify uses the shortest round-trippable representation, which is
      // stable across V8 versions and matches what Postgres returns for jsonb numerics
      // that were written from the same representation.
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(`Unsupported type "${typeof value}"`, path);
  }

  const object = value as object;
  if (seen.has(object)) throw new CanonicalJsonError('Cyclic reference', path);
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const parts = object.map((entry, index) => encode(entry, `${path}[${index}]`, seen));
      return `[${parts.join(',')}]`;
    }
    if (object instanceof Date) {
      throw new CanonicalJsonError('Date must be converted to an ISO string first', path);
    }
    const source = object as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${encode(entry, `${path}.${key}`, seen)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(object);
  }
}

/** Serialise `value` to a byte-stable JSON string with lexicographically sorted keys. */
export function canonicalJson(value: JsonValue): string {
  return encode(value, '', new Set<object>());
}

/**
 * Assert at runtime that an untrusted value is JSON-safe and canonicalisable.
 * Used on the audit write path so a bad `metadata` payload fails at the call site
 * rather than producing an event whose hash can never be re-verified.
 */
export function assertJsonObject(value: unknown, label = 'value'): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalJsonError(`${label} must be a plain object`, '');
  }
  canonicalJson(value as JsonValue);
  return value as JsonObject;
}
