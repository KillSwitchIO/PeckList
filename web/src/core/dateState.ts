import { datePart, daysBetween } from './dates.ts';
import type { Task } from './types.ts';

export type DateState = 'late' | 'slipped' | 'dueSoon' | 'normal' | 'none';

/** Date state per the Design Spec: late beats slipped beats due soon. */
export function dateState(task: Task, today: string, dueSoonDays: number): DateState {
  const due = task.due ? datePart(task.due.at) : null;
  const scheduleEnd = task.schedule ? datePart(task.schedule.end ?? task.schedule.start) : null;
  if (!due && !scheduleEnd) return 'none';
  if (task.status !== 'open') return 'normal';
  if (due && due < today) return 'late';
  if (!due && scheduleEnd && scheduleEnd < today) return 'late';
  if (due && scheduleEnd && scheduleEnd < today) return 'slipped';
  if (due && daysBetween(today, due) <= dueSoonDays) return 'dueSoon';
  return 'normal';
}
