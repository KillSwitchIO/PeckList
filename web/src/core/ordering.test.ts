import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareByOrder,
  compareOrderKeys,
  isOrderKey,
  keyBetween,
  keysBetween,
} from './ordering.ts';

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

  it('stays short however many are added to the end or the start of a list', () => {
    let last = keyBetween(null, null);
    let first = last;
    for (let i = 0; i < 20_000; i += 1) {
      const nextLast = keyBetween(last, null);
      expect(nextLast > last).toBe(true);
      last = nextLast;
      const nextFirst = keyBetween(null, first);
      expect(nextFirst < first).toBe(true);
      first = nextFirst;
    }
    expect(last.length).toBeLessThanOrEqual(5);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(isOrderKey(last) && isOrderKey(first)).toBe(true);
  });

  it('stops a long key from an older version growing further', () => {
    const old = `${'z'.repeat(528)}l`;
    let key = old;
    for (let i = 0; i < 5_000; i += 1) key = keyBetween(key, null);
    expect(key > old).toBe(true);
    expect(key.length).toBeLessThanOrEqual(old.length + 3);
  });

  it('finds a key past the top and below the bottom of the alphabet', () => {
    expect(keyBetween('zzz', null) > 'zzz').toBe(true);
    expect(isOrderKey(keyBetween('zzz', null))).toBe(true);
    for (const key of ['1', '01', '0001', '10', '0zz1'].filter(isOrderKey)) {
      const below = keyBetween(null, key);
      expect(below < key).toBe(true);
      expect(isOrderKey(below)).toBe(true);
    }
  });

  it('always goes past either open end of any key (property)', () => {
    const keyArb = fc.stringMatching(/^[0-9A-Za-z]{0,6}[1-9A-Za-z]$/);
    fc.assert(
      fc.property(keyArb, (key) => {
        const above = keyBetween(key, null);
        const below = keyBetween(null, key);
        return above > key && below < key && isOrderKey(above) && isOrderKey(below);
      }),
    );
  });

  it('settles a shared key by id, the same on every device', () => {
    const a = { order: 'V', id: '01A' };
    const b = { order: 'V', id: '01B' };
    const earlier = { order: 'U', id: '01Z' };
    expect([b, a, earlier].sort(compareByOrder)).toEqual([earlier, a, b]);
    expect([a, b, earlier].sort(compareByOrder)).toEqual([earlier, a, b]);
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

  it('stays short for a long list', () => {
    const keys = keysBetween(null, null, 20_000);
    expect(new Set(keys).size).toBe(20_000);
    expect([...keys].sort(compareOrderKeys)).toEqual(keys);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(8);
  });

  it('returns nothing for zero', () => {
    expect(keysBetween(null, null, 0)).toEqual([]);
  });

  it('compares equal keys as equal', () => {
    expect(compareOrderKeys('A', 'A')).toBe(0);
  });
});
