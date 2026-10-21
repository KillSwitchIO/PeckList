// Local calendar dates as `YYYY-MM-DD` strings. Schedules and due dates store a local date or
// local date-time plus a time zone, so "today" must be computed in that zone.

import type { LocalDateOrDateTime } from './types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in `timeZone` (IANA name), e.g. `2026-10-20`. */
export function todayIn(timeZone: string, now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The date part of a local date or date-time. */
export function datePart(value: LocalDateOrDateTime): string {
  return value.slice(0, 10);
}

/** The time part (`HH:mm`) of a local date-time, or null for a plain date. */
export function timePart(value: LocalDateOrDateTime): string | null {
  return value.length > 10 ? value.slice(11, 16) : null;
}

export function addDays(date: string, days: number): string {
  if (!DATE.test(date)) throw new Error(`invalid date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const toUtc = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** `YYYY-MM` of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** First day of the month `offset` months after the month of `date`. */
export function addMonths(date: string, offset: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const shifted = new Date(Date.UTC(y, m - 1 + offset, 1));
  return shifted.toISOString().slice(0, 10);
}

/** Day of week, 0 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The 42 dates (6 weeks) shown for a month, starting on `weekStartsOn` (0 = Sunday).
 * `month` is any date in the month.
 */
export function monthGrid(month: string, weekStartsOn = 0): string[] {
  const first = `${monthOf(month)}-01`;
  const lead = (weekday(first) - weekStartsOn + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** Combine a date and an optional `HH:mm` time into a local date or date-time. */
export function joinDateTime(date: string, time: string | null): LocalDateOrDateTime {
  return time ? `${date}T${time}` : date;
}
