import { daysBetween, localDayOf, localTimeZone } from '../../core/dates.ts';
import type { Task } from '../../core/types.ts';
import { formatMonth } from '../format.ts';
import { dayTitle } from './dayLabels.ts';

export interface ClosedGroup {
  key: string;
  title: string;
  tasks: Task[];
}

/** The local day a closed task was completed (or marked won't do). */
export function closedDay(task: Task, zone = localTimeZone()): string | null {
  return task.completedAt ? localDayOf(task.completedAt, zone) : null;
}

/**
 * Tasks (newest first) grouped by a day of theirs: each of the last seven days on its own
 * ("Wednesday, Today"), older ones by month ("September", or "September 2025" in other years), undated last.
 */
function groupByDay(
  tasks: Task[],
  dayOf: (task: Task) => string | null,
  today: string,
): ClosedGroup[] {
  const groups = new Map<string, ClosedGroup>();
  for (const task of tasks) {
    const day = dayOf(task);
    let key = 'none';
    let title = '';
    if (day && daysBetween(day, today) < 7) {
      key = day;
      title = dayTitle(day, today);
    } else if (day) {
      key = day.slice(0, 7);
      title = formatMonth(key, today);
    }
    const group = groups.get(key) ?? { key, title, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Closed tasks by when they closed. */
export function groupClosed(tasks: Task[], today: string, zone = localTimeZone()): ClosedGroup[] {
  return groupByDay(tasks, (task) => closedDay(task, zone), today);
}

/** Tasks in the trash by when they were deleted. */
export function groupDeleted(tasks: Task[], today: string, zone = localTimeZone()): ClosedGroup[] {
  return groupByDay(
    tasks,
    (task) => (task.deletedAt ? localDayOf(task.deletedAt, zone) : null),
    today,
  );
}
