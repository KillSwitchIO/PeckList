import { useTheme } from '@mui/material';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { startState } from '../../core/queries.ts';
import type { Task } from '../../core/types.ts';
import { formatDay, formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';

/**
 * What a task row shows on the right: the start date and time, or, once closed, the day it was
 * completed. `completedDay` is set in the second case.
 */
export function useRowDate(task: Task): {
  text: string | null;
  color: string;
  completedDay: string | null;
} {
  const theme = useTheme();
  const today = useToday();
  const done = task.status !== 'open';
  const start = task.schedule?.start;
  const completedDay =
    done && task.completedAt ? todayIn(localTimeZone(), Date.parse(task.completedAt)) : null;
  const text = completedDay
    ? formatDay(completedDay, today)
    : start
      ? formatWhen(start, today)
      : null;
  const state = startState(task, today);
  const color = done
    ? 'text.disabled'
    : state === 'overdue'
      ? theme.punchlist.dateState.late
      : theme.punchlist.dateState.dueSoon;
  return { text, color, completedDay };
}
