// The Upcoming and Due dates views (spec: PL-091): tasks day by day from a chosen day on, and
// tasks with a due date in deadline groups, with a way to move many due dates at once.

import { putEntities, requireEntity } from './collections.ts';
import { addDays, datePart, daysBetween, timePart } from './dates.ts';
import { filterTasks, groupByDay, placeDate } from './filters.ts';
import { updateEntity, type OpContext } from './ops.ts';
import type { Id, Task, WorkspaceFile } from './types.ts';

/** `count` days from `from` (empty ones too), each with the open tasks that start on it. */
export function agendaDays(
  workspace: WorkspaceFile,
  today: string,
  from: string,
  count: number,
): { date: string; tasks: Task[] }[] {
  const offset = daysBetween(today, from);
  const placed = new Map(
    groupByDay(
      filterTasks(workspace, { start: { from: offset, to: offset + count - 1 } }, today),
    ).map((day) => [day.date, day.tasks]),
  );
  // A task spanning days that is still running shows on today, not as overdue.
  if (daysBetween(today, from) <= 0 && daysBetween(today, addDays(from, count - 1)) >= 0) {
    const running = filterTasks(workspace, { start: { to: -1 } }, today).filter(
      (task) => placeDate(task, today) === today,
    );
    if (running.length) placed.set(today, [...running, ...(placed.get(today) ?? [])]);
  }
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(from, index);
    return { date, tasks: placed.get(date) ?? [] };
  });
}

export type DueGroupKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';

/** Open tasks with a due date: Overdue, Today, Tomorrow, the rest of the week, Later (soonest first). */
export function dueGroups(
  workspace: WorkspaceFile,
  today: string,
): { key: DueGroupKey; tasks: Task[] }[] {
  const tasks = filterTasks(workspace, { hasDue: true, closed: false }, today).sort((a, b) =>
    (a.due?.at ?? '').localeCompare(b.due?.at ?? ''),
  );
  const order: DueGroupKey[] = ['overdue', 'today', 'tomorrow', 'week', 'later'];
  const buckets = new Map<DueGroupKey, Task[]>();
  for (const task of tasks) {
    const days = daysBetween(today, datePart(task.due!.at));
    const key: DueGroupKey =
      days < 0
        ? 'overdue'
        : days === 0
          ? 'today'
          : days === 1
            ? 'tomorrow'
            : days <= 7
              ? 'week'
              : 'later';
    buckets.set(key, [...(buckets.get(key) ?? []), task]);
  }
  return order.filter((key) => buckets.has(key)).map((key) => ({ key, tasks: buckets.get(key)! }));
}

/**
 * Move many tasks' due dates to `date` (null: no due date). Each keeps its own time of day; a
 * task without a due date gets an all-day one.
 */
export function setDueDates(
  ctx: OpContext,
  workspace: WorkspaceFile,
  ids: readonly Id[],
  date: string | null,
  timeZone: string,
): WorkspaceFile {
  const changed: Task[] = [];
  for (const id of ids) {
    const task = requireEntity(workspace, 'tasks', id);
    if (date === null) {
      if (task.due) changed.push(updateEntity(ctx, task, { due: null }));
      continue;
    }
    const time = task.due ? timePart(task.due.at) : null;
    const at = time ? `${date}T${time}` : date;
    if (task.due?.at === at) continue;
    changed.push(
      updateEntity(ctx, task, {
        due: { at, allDay: time === null, timeZone: task.due?.timeZone ?? timeZone },
      }),
    );
  }
  return changed.length === 0 ? workspace : putEntities(workspace, 'tasks', changed);
}
