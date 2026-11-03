import { useTheme } from '@mui/material';
import { useContext } from 'react';
import { datePart, localDayOf, localTimeZone, timePart } from '../../core/dates.ts';
import { startState } from '../../core/queries.ts';
import type { Task } from '../../core/types.ts';
import { formatDay, formatTime, formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { PageDay } from './pageDay.ts';

/**
 * What a task row shows on the right: the start date and time (or the due date when there is no
 * start, or always with `dueFirst`), or, once closed, the day it was completed. `completedDay` is
 * set in that case. A span over several days has its end too (R-FB-136). On a page about one day
 * (`PageDay`), `shown` leaves that day out: just the time, or nothing for an all-day task.
 */
export function useRowDate(
  task: Task,
  dueFirst = false,
): {
  text: string | null;
  /** What the row shows: `text`, without the page's own day on a day page. */
  shown: string | null;
  /** Where a span over several days ends ("Thu, Oct 30"), shown after the start. */
  endText: string | null;
  color: string;
  completedDay: string | null;
  /** The text is the due date (the task has no start date). */
  showsDue: boolean;
  /** The due date, when the task has one ("Tomorrow, 5:00 PM"). */
  due: string | null;
} {
  const theme = useTheme();
  const today = useToday();
  const pageDay = useContext(PageDay);
  const done = task.status !== 'open';
  const start = task.schedule?.start;
  const completedDay =
    done && task.completedAt ? localDayOf(task.completedAt, localTimeZone()) : null;
  const due = task.due ? formatWhen(task.due.at, today) : null;
  // No start date: the due date stands in.
  const showsDue = !completedDay && (dueFirst || !start) && due !== null;
  const text = completedDay
    ? formatDay(completedDay, today)
    : showsDue
      ? due
      : start
        ? formatWhen(start, today)
        : null;
  const end = task.schedule?.end;
  const endText =
    !completedDay && !showsDue && start && end && datePart(end) !== datePart(start)
      ? formatWhen(end, today)
      : null;
  // On the page's own day the date is the page title already: keep the time, drop the day.
  const onPage = (value: string) => pageDay !== null && datePart(value) === pageDay;
  const timeOnly = (value: string) => {
    const time = timePart(value);
    return time ? formatTime(time) : null;
  };
  const shown = endText
    ? text
    : completedDay
      ? completedDay === pageDay
        ? null
        : text
      : showsDue
        ? onPage(task.due!.at)
          ? timeOnly(task.due!.at)
          : text
        : start && onPage(start)
          ? timeOnly(start)
          : text;
  const state =
    showsDue && dueFirst
      ? datePart(task.due!.at) < today
        ? 'overdue'
        : 'later'
      : startState(task, today);
  const color = done
    ? 'text.disabled'
    : state === 'overdue'
      ? theme.pecklist.dateState.late
      : theme.pecklist.dateState.dueSoon;
  return { text, shown, endText, color, completedDay, showsDue, due };
}
