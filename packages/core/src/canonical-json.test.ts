import { describe, expect, it } from 'vitest';
import { assertJsonObject, canonicalJson, CanonicalJsonError } from './canonical-json.js';

describe('canonicalJson', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys at every depth but preserves array order', () => {
    expect(canonicalJson({ z: { y: 1, x: [3, 1, 2] } })).toBe('{"z":{"x":[3,1,2],"y":1}}');
  });

  it('drops undefined values, which JSON round-trips would lose anyway', () => {
    expect(canonicalJson({ a: 1, b: undefined as never })).toBe('{"a":1}');
  });

  it('escapes strings the same way JSON does, including unicode', () => {
    expect(canonicalJson({ name: 'Ärger "quoted"\n', emoji: '🧾' })).toBe(
      '{"emoji":"🧾","name":"Ärger \\"quoted\\"\\n"}',
    );
  });

  it('rejects values that cannot be reproduced from a jsonb read-back', () => {
    expect(() => canonicalJson({ n: Number.NaN } as never)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY } as never)).toThrow(
      CanonicalJsonError,
    );
    expect(() => canonicalJson({ at: new Date() } as never)).toThrow(/ISO string/);
  });

  it('rejects cycles instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic as never)).toThrow(/Cyclic/);
  });

  it('assertJsonObject only accepts plain objects', () => {
    expect(assertJsonObject({ ok: true })).toEqual({ ok: true });
    expect(() => assertJsonObject([1, 2] as never)).toThrow(CanonicalJsonError);
    expect(() => assertJsonObject('nope' as never)).toThrow(CanonicalJsonError);
  });
});
