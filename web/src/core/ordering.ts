// Fractional index keys for manual ordering.
//
// Keys are strings over a base-62 alphabet whose ASCII order matches digit order, so plain
// string comparison sorts them. A key between any two keys always exists, so moving one
// item only rewrites that item's key. Keys never end in '0' (the smallest digit), which
// guarantees there is always room to insert before a key.

import type { OrderKey } from './types.ts';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const ZERO = DIGITS.charAt(0);
const KEY_PATTERN = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export function isOrderKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function compareOrderKeys(a: OrderKey, b: OrderKey): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function digit(char: string | undefined): number {
  return char === undefined ? 0 : DIGITS.indexOf(char);
}

/**
 * Midpoint between two fractional digit strings. `a` may be '' (zero), `b` may be null (one).
 * Requires a < b and neither ending in '0'.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let shared = 0;
    while ((a.charAt(shared) || ZERO) === b.charAt(shared)) {
      shared += 1;
    }
    if (shared > 0) {
      return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
    }
  }
  const lo = a === '' ? 0 : digit(a.charAt(0));
  const hi = b === null ? BASE : digit(b.charAt(0));
  if (hi - lo > 1) {
    return DIGITS.charAt(Math.round((lo + hi) / 2));
  }
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS.charAt(lo) + midpoint(a.slice(1), null);
}

/** A key strictly between `before` and `after`. Either side may be null (open end). */
export function keyBetween(before: OrderKey | null, after: OrderKey | null): OrderKey {
  if (before !== null && !isOrderKey(before)) throw new Error(`invalid order key: ${before}`);
  if (after !== null && !isOrderKey(after)) throw new Error(`invalid order key: ${after}`);
  if (before !== null && after !== null && before >= after) {
    throw new Error(`order keys out of order: ${before} >= ${after}`);
  }
  return midpoint(before ?? '', after);
}

/** `count` evenly spread keys between `before` and `after`, in ascending order. */
export function keysBetween(
  before: OrderKey | null,
  after: OrderKey | null,
  count: number,
): OrderKey[] {
  if (count <= 0) return [];
  if (count === 1) return [keyBetween(before, after)];
  const middleIndex = Math.floor(count / 2);
  const middle = keyBetween(before, after);
  return [
    ...keysBetween(before, middle, middleIndex),
    middle,
    ...keysBetween(middle, after, count - middleIndex - 1),
  ];
}
