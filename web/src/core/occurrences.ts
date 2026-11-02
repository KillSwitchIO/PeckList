// A repeating task's dates to come (spec: PL-060): the task itself sits on its current date, and
// the date views (calendar, Upcoming, Next 7 days, a picked day) also show where it falls next,
// as projections of it. One of them can be skipped, or changed on its own (it becomes a task of
// its own and the series skips its date), leaving the rest of the series as it is.

import { isLive, requireEntity } from './collections.ts';
import { addDays, datePart, daysBetween, timePart } from './dates.ts';
import { members, type OpContext } from './ops.ts';
import { advance, formatRule, parseRule, upcomingDates } from './recurrence.ts';
import { createTask, setTaskStatus, updateTask } from './tasks.ts';
import type { Id, Task, WorkspaceFile } from './types.ts';

/** Which task and date a projection stands for. */
export interface Occurrence {
  taskId: Id;
  date: string;
}

const projections = new WeakMap<Task, Occurrence>();

/** The task and date a projected occurrence stands for; null for a real task. */
export function occurrenceOf(task: Task): Occurrence | null {
  return projections.get(task) ?? null;
}

/** The id a projection goes by in views (never stored): `<task id>@<date>`. */
export function occurrenceId(taskId: Id, date: string): string {
  return `${taskId}@${date}`;
}

/** The date a repeating task counts from: its start, or its due date. */
function anchorOf(task: Task): string | null {
  return task.schedule?.start ?? task.due?.at ?? null;
}

/** The task's schedule and due date moved by `days`, times kept. */
export function shifted(task: Task, days: number): Pick<Task, 'schedule' | 'due'> {
  const shift = (value: string) => {
    const time = timePart(value);
    const date = addDays(datePart(value), days);
    return time ? `${date}T${time}` : date;
  };
  return {
    schedule: task.schedule
      ? {
          ...task.schedule,
          start: shift(task.schedule.start),
          end: task.schedule.end ? shift(task.schedule.end) : null,
        }
      : null,
    due: task.due ? { ...task.due, at: shift(task.due.at) } : null,
  };
}

/**
 * Where the open repeating tasks among `tasks` fall from `from` to `to` (inclusive) after their
 * current date: a copy of each task moved to each date, marked as a projection (`occurrenceOf`).
 * Skipped dates, and series that count from completion, give none.
 */
export function projectOccurrences(tasks: readonly Task[], from: string, to: string): Task[] {
  const projected: Task[] = [];
  if (to < from) return projected;
  for (const task of tasks) {
    if (!isLive(task) || task.status !== 'open' || !task.recurrence) continue;
    const rule = parseRule(task.recurrence);
    const anchor = anchorOf(task);
    if (!rule || !anchor) continue;
    const current = datePart(anchor);
    for (const date of upcomingDates(rule, current, from, to)) {
      const copy: Task = {
        ...task,
        id: occurrenceId(task.id, date),
        ...shifted(task, daysBetween(current, date)),
      };
      projections.set(copy, { taskId: task.id, date });
      projected.push(copy);
    }
  }
  return projected;
}

/**
 * Skip one occurrence of a repeating task, leaving the rest of the series. The current one moves
 * the task on to its next date (the last one closes it as won't do); one to come is left out of
 * the series.
 */
export function skipOccurrence(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  date: string,
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  const rule = parseRule(task.recurrence);
  const anchor = anchorOf(task);
  if (!rule || !anchor) return workspace;
  const current = datePart(anchor);
  if (date < current) return workspace;
  if (date === current) {
    const step = advance(rule, current, current);
    if (!step) return setTaskStatus(ctx, workspace, id, 'wontdo');
    return updateTask(ctx, workspace, id, {
      ...shifted(task, daysBetween(current, step.date)),
      recurrence: formatRule(step.rule),
    });
  }
  const skip = [...new Set([...(rule.skip ?? []), date])].sort();
  return updateTask(ctx, workspace, id, { recurrence: formatRule({ ...rule, skip }) });
}

/**
 * Change one occurrence on its own: it becomes a task of its own (the same title, notes, list,
 * priority, tags, people and reminders before its time, not repeating), on that date or on the
 * dates `change` gives, and the series skips that date. The new task is returned to be opened.
 */
export function detachOccurrence(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  date: string,
  change: Partial<Pick<Task, 'schedule' | 'due'>> = {},
): { workspace: WorkspaceFile; task: Task } | null {
  const task = requireEntity(workspace, 'tasks', id);
  const anchor = anchorOf(task);
  if (!parseRule(task.recurrence) || !anchor || date < datePart(anchor)) return null;
  const moved = { ...shifted(task, daysBetween(datePart(anchor), date)), ...change };
  const skipped = skipOccurrence(ctx, workspace, id, date);
  const made = createTask(ctx, skipped, {
    title: task.title,
    notes: task.notes,
    listId: task.listId,
    parentId: task.parentId,
    afterId: task.id,
    priority: task.priority,
    schedule: moved.schedule,
    due: moved.due,
    tags: members(task.tags),
    assignees: members(task.assignees),
    reminders: (task.reminders ?? []).filter((each) => 'before' in each),
    recurrence: null,
  });
  return made;
}

/**
 * Close one occurrence, done or won't do. The current one closes as the task does (a closed copy
 * in history, the task on to its next date); one to come leaves a closed task of its own for that
 * date, and the series skips it.
 */
export function closeOccurrence(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  date: string,
  status: 'done' | 'wontdo',
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  const anchor = anchorOf(task);
  if (!anchor || date <= datePart(anchor)) return setTaskStatus(ctx, workspace, id, status);
  const made = detachOccurrence(ctx, workspace, id, date);
  return made ? setTaskStatus(ctx, made.workspace, made.task.id, status) : workspace;
}
