import { daysBetween, localTimeZone, todayIn } from '../../core/dates.ts';
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
  return task.completedAt ? todayIn(zone, Date.parse(task.completedAt)) : null;
}

/**
 * Closed tasks (newest first) grouped by when they closed: each of the last seven days on its own
 * ("Wednesday, Today"), older ones by month ("September", or "September 2025" in other years), undated last.
 */
export function groupClosed(tasks: Task[], today: string, zone = localTimeZone()): ClosedGroup[] {
  const groups = new Map<string, ClosedGroup>();
  for (const task of tasks) {
    const day = closedDay(task, zone);
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
