import { formatMonth } from '../format.ts';

/** "October" for `2026-10` this year, "October 2027" in other years. */
export function monthTitle(month: string, today: string): string {
  return formatMonth(month, today);
}

/** The weekdays' first letters, starting on `weekStart` (0 Sunday). */
export function weekdayInitials(weekStart: number): string[] {
  const format = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
  // 2026-10-04 is a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    format.format(Date.UTC(2026, 9, 4 + ((weekStart + index) % 7))),
  );
}
