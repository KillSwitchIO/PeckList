import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareOrderKeys, isOrderKey, keyBetween, keysBetween } from './ordering.ts';

describe('keyBetween', () => {
  it('creates a first key', () => {
    const key = keyBetween(null, null);
    expect(isOrderKey(key)).toBe(true);
  });

  it('creates keys before and after', () => {
    const middle = keyBetween(null, null);
    const before = keyBetween(null, middle);
    const after = keyBetween(middle, null);
    expect([after, middle, before].sort(compareOrderKeys)).toEqual([before, middle, after]);
  });

  it('handles adjacent digits by extending the key', () => {
    const key = keyBetween('A', 'B');
    expect(key > 'A' && key < 'B').toBe(true);
    expect(isOrderKey(key)).toBe(true);
  });

  it('handles long shared prefixes', () => {
    const key = keyBetween('VVVV1', 'VVVV2');
    expect(key > 'VVVV1' && key < 'VVVV2').toBe(true);
  });

  it('rejects invalid or reversed keys', () => {
    expect(() => keyBetween('B', 'A')).toThrow('out of order');
    expect(() => keyBetween('A', 'A')).toThrow('out of order');
    expect(() => keyBetween('A0', null)).toThrow('invalid order key');
    expect(() => keyBetween(null, 'bad!')).toThrow('invalid order key');
  });

  it('always fits between any two ordered keys (property)', () => {
    const keyArb = fc.stringMatching(/^[0-9A-Za-z]{0,6}[1-9A-Za-z]$/);
    fc.assert(
      fc.property(keyArb, keyArb, (x, y) => {
        fc.pre(x !== y);
        const [lo, hi] = x < y ? [x, y] : [y, x];
        const key = keyBetween(lo, hi);
        return key > lo && key < hi && isOrderKey(key);
      }),
    );
  });

  it('survives repeated inserts at the front, back and middle', () => {
    let keys = [keyBetween(null, null)];
    for (let i = 0; i < 200; i += 1) {
      keys = [keyBetween(null, keys[0]!), ...keys, keyBetween(keys[keys.length - 1]!, null)];
      const mid = Math.floor(keys.length / 2);
      keys.splice(mid, 0, keyBetween(keys[mid - 1]!, keys[mid]!));
    }
    expect([...keys].sort(compareOrderKeys)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('keysBetween', () => {
  it('returns ascending, distinct keys', () => {
    const keys = keysBetween(null, null, 10);
    expect(keys).toHaveLength(10);
    expect([...keys].sort(compareOrderKeys)).toEqual(keys);
    expect(new Set(keys).size).toBe(10);
  });

  it('returns nothing for zero', () => {
    expect(keysBetween(null, null, 0)).toEqual([]);
  });

  it('compares equal keys as equal', () => {
    expect(compareOrderKeys('A', 'A')).toBe(0);
  });
});
