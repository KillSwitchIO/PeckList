import { addDays, timePart } from './dates.ts';
import { placeDate } from './filters.ts';
import { todayTasks } from './queries.ts';
import type { Priority, WorkspaceFile } from './types.ts';

/**
 * One task for the Android home-screen widgets (PL-121): the day it belongs to in Today, as
 * the Today page places it (`on`), and as it will tomorrow (`next`), so the widget shows the
 * right day after midnight without the app.
 */
export interface WidgetTask {
  id: string;
  title: string;
  on: string;
  next: string;
  /** Its start time ("HH:mm"); absent for an all-day task. */
  time?: string;
  priority: Priority;
  /** Its list's color. */
  color: string;
}

/** What the widgets get: the day the hand-over was made, and the tasks for it and the next. */
export interface WidgetFeed {
  asOf: string;
  tasks: WidgetTask[];
  /** Signed out: the widgets ask to open the app rather than show an empty day. */
  signedOut?: true;
}

/** How many tasks the widgets keep: more than a widget can show, and a bound on the hand-over. */
export const WIDGET_TASK_LIMIT = 100;

/**
 * Today's open tasks and tomorrow's (overdue included), as the Today page chooses them, overdue
 * first, then by day and time.
 */
export function widgetFeed(workspace: WorkspaceFile, today: string): WidgetFeed {
  const tomorrow = addDays(today, 1);
  const colors = new Map(workspace.entities.lists.map((list) => [list.id, list.color]));
  const tasks = todayTasks(workspace, tomorrow).map((task): WidgetTask => {
    const time = task.schedule && !task.schedule.allDay ? timePart(task.schedule.start) : null;
    return {
      id: task.id,
      title: task.title,
      on: placeDate(task, today)!,
      next: placeDate(task, tomorrow)!,
      ...(time ? { time } : {}),
      priority: task.priority,
      color: colors.get(task.listId) ?? '',
    };
  });
  tasks.sort(
    (a, b) =>
      a.on.localeCompare(b.on) ||
      (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
      a.title.localeCompare(b.title),
  );
  return { asOf: today, tasks: tasks.slice(0, WIDGET_TASK_LIMIT) };
}
