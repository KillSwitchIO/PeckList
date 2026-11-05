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

/**
 * Display order for things with order keys. Two can hold the same key: devices that each add to
 * the end before syncing pick the same one, and so does a task restored from the trash when a new
 * one took its place. The id settles it, so every device shows them the same way round.
 */
export function compareByOrder(
  a: { order: OrderKey; id: string },
  b: { order: OrderKey; id: string },
): number {
  return compareOrderKeys(a.order, b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
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

/** Digits added when a key has no room left at its length: about 235,000 more keys each time. */
const ROOM = 3;

const toKey = (digits: readonly number[]) => digits.map((each) => DIGITS.charAt(each)).join('');

/**
 * The next key up, at the same length, counting as a number does. Halving the gap to the end
 * instead cost a character every five keys, so a list's keys grew with its length (a 2,700-task
 * list held 700 KB of them).
 */
function keyAfter(key: OrderKey): OrderKey {
  const digits = [...key].map(digit);
  let at = digits.length - 1;
  while (at >= 0 && digits[at] === BASE - 1) {
    digits[at] = 0;
    at -= 1;
  }
  if (at < 0) return `${key}${'0'.repeat(ROOM - 1)}1`;
  digits[at] = digits[at]! + 1;
  if (digits[digits.length - 1] === 0) digits[digits.length - 1] = 1;
  return toKey(digits);
}

/** The next key down, at the same length: {@link keyAfter}, the other way. */
function keyBefore(key: OrderKey): OrderKey {
  const digits = [...key].map(digit);
  // Twice when the first lands on a key ending in zero, which keys never do.
  for (let step = 0; step < 2; step += 1) {
    let at = digits.length - 1;
    while (at >= 0 && digits[at] === 0) {
      digits[at] = BASE - 1;
      at -= 1;
    }
    if (at < 0) return `${'0'.repeat(digits.length)}${DIGITS.charAt(BASE - 1).repeat(ROOM)}`;
    digits[at] = digits[at]! - 1;
    if (digits[digits.length - 1] !== 0) break;
  }
  return toKey(digits);
}

/** A key strictly between `before` and `after`. Either side may be null (open end). */
export function keyBetween(before: OrderKey | null, after: OrderKey | null): OrderKey {
  if (before !== null && !isOrderKey(before)) throw new Error(`invalid order key: ${before}`);
  if (after !== null && !isOrderKey(after)) throw new Error(`invalid order key: ${after}`);
  if (before !== null && after !== null && before >= after) {
    throw new Error(`order keys out of order: ${before} >= ${after}`);
  }
  if (before !== null && after === null) return keyAfter(before);
  if (before === null && after !== null) return keyBefore(after);
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
