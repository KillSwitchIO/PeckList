import { startDate } from '../../core/filters.ts';
import type { Task } from '../../core/types.ts';
import { addDays } from '../../core/dates.ts';
import { customDateFormat, formatDay } from '../format.ts';

/** Long weekday name of a local date, e.g. "Tuesday". */
export function weekdayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

/** "Thursday, Tomorrow", "Friday, October 23" (the weekday once), or the weekday and the user's own pattern. */
export function dayTitle(date: string, today: string): string {
  const near = date === today || date === addDays(today, 1) || date === addDays(today, -1);
  if (near || customDateFormat()) return `${weekdayName(date)}, ${formatDay(date, today)}`;
  return dayHeading(date, today);
}

/** In date groups a subtask with its own start date sits on that date, not under its parent. */
export const hasOwnDate = (task: Task) => startDate(task) !== null;

/** Where a day opens: Today for today, else its own page (spec: PL-090). */
export function dayPath(date: string, today: string): string {
  return date === today ? '/today' : `/day/${date}`;
}

/**
 * A day page's heading: "Monday, October 26" ("Mon, Oct 26" short, for phones), with the year only when it is not this year's
 * (Ben, 2026-10-23: the year is noise for this year's dates).
 */
export function dayHeading(date: string, today: string, short = false): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: short ? 'short' : 'long',
    month: short ? 'short' : 'long',
    day: 'numeric',
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(Date.UTC(year!, month! - 1, day!));
}
