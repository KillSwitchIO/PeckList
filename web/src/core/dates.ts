// Local calendar dates as `YYYY-MM-DD` strings. Schedules and due dates store a local date or
// local date-time plus a time zone, so "today" must be computed in that zone.

import type { LocalDateOrDateTime } from './types.ts';
import { dateTimeFormat } from './intl.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in `timeZone` (IANA name), e.g. `2026-10-20`. */
export function todayIn(timeZone: string, now: number): string {
  const parts = dateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Views ask for the day of the same instants (when tasks were completed) on every render: one
// conversion per instant and zone, kept (R-FB-94: 4,279 a render made Today 100 ms slower).
const instantDays = new Map<string, string>();

/** The local date (`YYYY-MM-DD`) of an ISO instant in `timeZone`. */
export function localDayOf(instant: string, timeZone: string): string {
  const key = `${timeZone}|${instant}`;
  let day = instantDays.get(key);
  if (day === undefined) {
    day = todayIn(timeZone, Date.parse(instant));
    if (instantDays.size >= 100_000) instantDays.clear();
    instantDays.set(key, day);
  }
  return day;
}

/** An instant's wall-clock date and time in `timeZone`, as `YYYY-MM-DDTHH:mm`. */
export function localDateTimeOf(instant: string, timeZone: string): string {
  const parts = dateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.parse(instant)));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * The UTC instant (ISO, milliseconds) when the wall clock in `timeZone` shows `date` `time`.
 * In a skipped hour (daylight saving starts) it lands just after the gap.
 */
export function instantOf(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  // Guess, then correct by the zone's offset at the guess (twice covers offset changes).
  let guess = wanted;
  for (let i = 0; i < 2; i += 1) {
    const shown = localDateTimeOf(new Date(guess).toISOString(), timeZone);
    const [sd, st] = shown.split('T') as [string, string];
    const [sy, smo, sdd] = sd.split('-').map(Number) as [number, number, number];
    const [sh, smi] = st.split(':').map(Number) as [number, number];
    guess += wanted - Date.UTC(sy, smo - 1, sdd, sh, smi);
  }
  return new Date(guess).toISOString();
}

let chosenTimeZone: string | null = null;

/**
 * Use `zone` as "local" from now on: the person's own setting, else the server's (spec: PL-086).
 * Null goes back to the device's. A name the browser does not know is ignored.
 */
export function setTimeZone(zone: string | null): void {
  chosenTimeZone = zone && isTimeZone(zone) ? zone : null;
}

/** Whether the browser knows `zone` as an IANA time zone. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The device's own time zone. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The time zone "today" and every wall-clock time are in: chosen, else the device's. */
export function localTimeZone(): string {
  return chosenTimeZone ?? deviceTimeZone();
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

/** The same day `offset` months later, clamped to the month's last day (Jan 31 + 1 = Feb 28). */
export function shiftMonths(date: string, offset: number): string {
  const first = addMonths(date, offset);
  const [y, m] = first.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Number(date.slice(8, 10)), lastDay);
  return `${first.slice(0, 8)}${String(day).padStart(2, '0')}`;
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

/**
 * A wall-clock value from one time zone as the wall clock in another shows the same moment. A
 * date without a time (all day) is the same date everywhere and stays as it is.
 */
export function shiftZone(
  value: LocalDateOrDateTime,
  from: string,
  to: string,
): LocalDateOrDateTime {
  const time = timePart(value);
  if (time === null || from === to) return value;
  return localDateTimeOf(instantOf(datePart(value), time, from), to);
}
