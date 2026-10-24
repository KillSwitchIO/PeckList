/** "October 2026" for `2026-10`. */
export function monthTitle(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year!, number! - 1, 1));
}

/** The weekdays' first letters, starting on `weekStart` (0 Sunday). */
export function weekdayInitials(weekStart: number): string[] {
  const format = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
  // 2026-10-04 is a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    format.format(Date.UTC(2026, 9, 4 + ((weekStart + index) % 7))),
  );
}
