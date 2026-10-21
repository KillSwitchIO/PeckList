import { useTheme } from '@mui/material';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { startState } from '../../core/queries.ts';
import type { Task } from '../../core/types.ts';
import { formatDay, formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';

/**
 * What a task row shows on the right: the start date and time (or the due date when there is no
 * start), or, once closed, the day it was completed. `completedDay` is set in that case.
 */
export function useRowDate(task: Task): {
  text: string | null;
  color: string;
  completedDay: string | null;
  /** The text is the due date (the task has no start date). */
  showsDue: boolean;
  /** The due date, when the task has one ("Tomorrow, 5:00 PM"). */
  due: string | null;
} {
  const theme = useTheme();
  const today = useToday();
  const done = task.status !== 'open';
  const start = task.schedule?.start;
  const completedDay =
    done && task.completedAt ? todayIn(localTimeZone(), Date.parse(task.completedAt)) : null;
  const due = task.due ? formatWhen(task.due.at, today) : null;
  // No start date: the due date stands in.
  const showsDue = !completedDay && !start && due !== null;
  const text = completedDay
    ? formatDay(completedDay, today)
    : start
      ? formatWhen(start, today)
      : due;
  const state = startState(task, today);
  const color = done
    ? 'text.disabled'
    : state === 'overdue'
      ? theme.punchlist.dateState.late
      : theme.punchlist.dateState.dueSoon;
  return { text, color, completedDay, showsDue, due };
}
