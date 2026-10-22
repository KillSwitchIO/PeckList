// What the calendar shows (spec: Design Spec, Calendar rendering) and what a drag on it means.
// Pure: the CalendarView port draws these items and reports moves in the same terms.

import { isLive } from './collections.ts';
import { addDays, datePart, joinDateTime, timePart } from './dates.ts';
import { inLiveList } from './filters.ts';
import type { Id, LocalDateOrDateTime, Priority, Schedule, Task, WorkspaceFile } from './types.ts';

/** One thing on the calendar: a task's schedule, or its due flag. */
export interface CalendarItem {
  /** The task id for a schedule; `due:<task id>` for a due flag. */
  id: string;
  taskId: Id;
  kind: 'schedule' | 'due';
  title: string;
  /** `YYYY-MM-DD` for all-day items, `YYYY-MM-DDTHH:mm` for timed ones (the viewer's wall clock). */
  start: LocalDateOrDateTime;
  /**
   * Timed: when it ends. All day: the last day, inclusive (null for one day). A start time with no
   * end lasts the point-event length.
   */
  end: LocalDateOrDateTime | null;
  allDay: boolean;
  /** The list's color. */
  color: string;
  priority: Priority;
  done: boolean;
  /** Can be dragged (due flags and read-only tasks cannot). */
  movable: boolean;
}

/** Where a drag left an item, in calendar terms (all-day ends inclusive, null for one day). */
export interface CalendarPlacement {
  start: LocalDateOrDateTime;
  end: LocalDateOrDateTime | null;
  allDay: boolean;
}

/** `HH:mm` plus minutes, rolling into the next day when it must. */
function addMinutes(value: LocalDateOrDateTime, minutes: number): LocalDateOrDateTime {
  const time = timePart(value) ?? '00:00';
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  const days = Math.floor(total / 1440);
  const rest = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(rest / 60)).padStart(2, '0');
  const mm = String(rest % 60).padStart(2, '0');
  return `${addDays(datePart(value), days)}T${hh}:${mm}`;
}

/**
 * The calendar's items for the days `from` to `to` (inclusive): live tasks in live lists with a
 * schedule or a due date that touches those days. `pointMinutes` is how long a start time with no
 * end is drawn. Pass the localized workspace (core/localized) so times are the viewer's.
 */
export function calendarItems(
  workspace: WorkspaceFile,
  from: string,
  to: string,
  pointMinutes: number,
  canEdit: (task: Task) => boolean = () => true,
): CalendarItem[] {
  const listed = inLiveList(workspace);
  const colors = new Map(workspace.entities.lists.map((list) => [list.id, list.color]));
  const items: CalendarItem[] = [];
  for (const task of workspace.entities.tasks) {
    if (!isLive(task) || !listed(task)) continue;
    const base = {
      taskId: task.id,
      title: task.title,
      color: colors.get(task.listId) ?? '#B8BCC4',
      priority: task.priority,
      done: task.status !== 'open',
    };
    if (task.schedule) {
      const { start, allDay } = task.schedule;
      const timed = !allDay && timePart(start) !== null;
      const end = task.schedule.end ?? (timed ? addMinutes(start, pointMinutes) : null);
      const first = datePart(start);
      const last = end ? datePart(end) : first;
      if (last >= from && first <= to) {
        items.push({
          ...base,
          id: task.id,
          kind: 'schedule',
          start: timed ? start : first,
          end: timed ? end : end && last !== first ? last : null,
          allDay: !timed,
          movable: canEdit(task),
        });
      }
    }
    if (task.due) {
      const day = datePart(task.due.at);
      if (day >= from && day <= to) {
        items.push({
          ...base,
          id: `due:${task.id}`,
          kind: 'due',
          start: day,
          end: null,
          allDay: true,
          movable: false,
        });
      }
    }
  }
  return items;
}

/**
 * The schedule a drag on the calendar gives a task. All day keeps the day count of a multi-day
 * span unless the drag set a new end; timed keeps a timed range's length when only the start
 * moved; a point event stays a point.
 */
export function placedSchedule(
  current: Schedule | null,
  placement: CalendarPlacement,
  timeZone: string,
): Schedule {
  if (placement.allDay) {
    const start = datePart(placement.start);
    let end = placement.end ? datePart(placement.end) : null;
    if (end === null && current?.allDay && current.end) {
      // Moved, not resized: the same number of days.
      const span = Math.round(
        (Date.parse(datePart(current.end)) - Date.parse(datePart(current.start))) / 86_400_000,
      );
      end = span > 0 ? addDays(start, span) : null;
    }
    return { start, end: end && end > start ? end : null, allDay: true, timeZone };
  }
  const start = placement.start;
  let end = placement.end;
  if (end === null && current && !current.allDay && current.end && timePart(current.start)) {
    const minutes =
      (Date.parse(`${current.end}:00Z`) - Date.parse(`${current.start}:00Z`)) / 60_000;
    end = minutes > 0 ? addMinutes(start, minutes) : null;
  }
  return { start, end, allDay: false, timeZone };
}

/** The schedule an unscheduled task gets when dropped on the calendar. */
export function droppedSchedule(day: string, time: string | null, timeZone: string): Schedule {
  return { start: joinDateTime(day, time), end: null, allDay: time === null, timeZone };
}

/** Open top-level tasks with no schedule, for the panel tasks are dragged in from. */
export function unscheduledTasks(workspace: WorkspaceFile): Task[] {
  const listed = inLiveList(workspace);
  return workspace.entities.tasks.filter(
    (task) =>
      isLive(task) &&
      listed(task) &&
      task.status === 'open' &&
      task.parentId === null &&
      !task.schedule,
  );
}
