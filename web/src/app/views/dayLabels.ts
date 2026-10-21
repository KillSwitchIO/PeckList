import { startDate } from '../../core/filters.ts';
import type { Task } from '../../core/types.ts';
import { formatDay } from '../format.ts';

/** Long weekday name of a local date, e.g. "Tuesday". */
export function weekdayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

/** "Thursday, Tomorrow", "Friday, Fri, Oct 23" */
export function dayTitle(date: string, today: string): string {
  return `${weekdayName(date)}, ${formatDay(date, today)}`;
}

/** In date groups a subtask with its own start date sits on that date, not under its parent. */
export const hasOwnDate = (task: Task) => startDate(task) !== null;
