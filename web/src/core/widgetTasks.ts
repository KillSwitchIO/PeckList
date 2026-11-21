import { addDays, timePart } from './dates.ts';
import { filterTasks, placeDate } from './filters.ts';
import { visibleLists } from './lists.ts';
import { occurrenceOf } from './occurrences.ts';
import { listTasks, todayTasks } from './queries.ts';
import { filterOf, savedFiltersOf } from './savedFilters.ts';
import type { Priority, Task, WorkspaceFile } from './types.ts';

/**
 * One task for the Android home-screen widgets (PL-121): the day it belongs to in Today, as
 * the Today page places it (`on`), and as it will tomorrow (`next`), so the widget shows the
 * right day after midnight without the app.
 */
export interface WidgetTask {
  id: string;
  title: string;
  /** Absent for a task with no date (one a list or a saved filter shows). */
  on?: string;
  next?: string;
  /** Its start time ("HH:mm"); absent for an all-day task. */
  time?: string;
  priority: Priority;
  /** Its list's color. */
  color: string;
}

/**
 * A list or saved filter a Today widget can be set to show (its configuration screen lists them):
 * its tasks' ids in the order the app shows them.
 */
export interface WidgetView {
  /** `list:<id>` or `filter:<id>`. */
  key: string;
  kind: 'inbox' | 'list' | 'filter';
  name: string;
  /** A list's color. */
  color?: string;
  ids: string[];
}

/** What the widgets get: the day the hand-over was made, and the tasks for it and the next. */
export interface WidgetFeed {
  asOf: string;
  tasks: WidgetTask[];
  /** Upcoming's tasks, from tomorrow through a day past its week, so it moves on at midnight. */
  upcoming?: string[];
  /** The lists, then the saved filters, a widget can show instead of Today (at most 50). */
  views?: WidgetView[];
  /** The tasks Upcoming and the views name that `tasks` does not carry. */
  more?: WidgetTask[];
  /** Signed out: the widgets ask to open the app rather than show an empty day. */
  signedOut?: true;
}

/** How many tasks the widgets keep for Today: more than a widget can show, and a bound on the hand-over. */
export const WIDGET_TASK_LIMIT = 100;
/** How many tasks each list, saved filter and Upcoming hands over: a tall widget shows about 15. */
export const WIDGET_VIEW_LIMIT = 30;
/**
 * How many lists and saved filters a widget can be set to, the lists first: a bound on the
 * hand-over, which the shell rewrites each time. A widget set to one past it reads as gone.
 */
export const WIDGET_VIEWS_LIMIT = 50;
/** Upcoming's days ahead, as the Upcoming page counts them. */
const UPCOMING_DAYS = 7;

/**
 * Today's open tasks and tomorrow's (overdue included), as the Today page chooses them, overdue
 * first, then by day and time.
 */
export function widgetFeed(workspace: WorkspaceFile, today: string): WidgetFeed {
  const tomorrow = addDays(today, 1);
  const colors = new Map(workspace.entities.lists.map((list) => [list.id, list.color]));
  const widgetTask = (task: Task): WidgetTask => {
    const time = task.schedule && !task.schedule.allDay ? timePart(task.schedule.start) : null;
    const on = placeDate(task, today);
    const next = placeDate(task, tomorrow);
    return {
      id: task.id,
      title: task.title,
      ...(on ? { on } : {}),
      ...(next ? { next } : {}),
      ...(time ? { time } : {}),
      priority: task.priority,
      color: colors.get(task.listId) ?? '',
    };
  };
  const tasks = todayTasks(workspace, tomorrow).map(widgetTask);
  tasks.sort(
    (a, b) =>
      (a.on ?? '').localeCompare(b.on ?? '') ||
      (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
      a.title.localeCompare(b.title),
  );
  const kept = tasks.slice(0, WIDGET_TASK_LIMIT);

  // Upcoming and the lists and saved filters a widget can be set to (PL-121): ids, and the tasks
  // `tasks` lacks. Repeating tasks' projected dates stay out: a widget ticks off real tasks only.
  const carried = new Set(kept.map((task) => task.id));
  const more = new Map<string, WidgetTask>();
  const ids = (found: Task[]) =>
    found
      .filter((task) => !occurrenceOf(task))
      .slice(0, WIDGET_VIEW_LIMIT)
      .map((task) => {
        if (!carried.has(task.id) && !more.has(task.id)) more.set(task.id, widgetTask(task));
        return task.id;
      });
  const upcoming = ids(
    filterTasks(workspace, { start: { from: 1, to: UPCOMING_DAYS + 1 } }, today),
  );
  const lists = visibleLists(workspace).slice(0, WIDGET_VIEWS_LIMIT);
  const filters = savedFiltersOf(workspace).slice(0, WIDGET_VIEWS_LIMIT - lists.length);
  const views: WidgetView[] = [
    ...lists.map((list): WidgetView => ({
      key: `list:${list.id}`,
      kind: list.isInbox ? 'inbox' : 'list',
      name: list.name,
      color: list.color,
      ids: ids(listTasks(workspace, list.id)),
    })),
    ...filters.map((saved): WidgetView => ({
      key: `filter:${saved.id}`,
      kind: 'filter',
      name: saved.name,
      ids: ids(filterTasks(workspace, filterOf(saved), today)),
    })),
  ];
  return { asOf: today, tasks: kept, upcoming, views, more: [...more.values()] };
}
