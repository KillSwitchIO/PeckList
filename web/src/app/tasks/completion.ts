import { instantOf, localDateTimeOf } from '../../core/dates.ts';
import type { Task } from '../../core/types.ts';
import type { DateValue } from '../dates/dateValue.ts';

/**
 * The instant for a picked completion date. A date without a time keeps the time the task was
 * completed at, or now's time.
 */
export function completionInstant(task: Task, value: DateValue, zone: string): string {
  const keep = localDateTimeOf(task.completedAt ?? new Date().toISOString(), zone).slice(11, 16);
  return instantOf(value.date, value.time ?? keep, zone);
}
