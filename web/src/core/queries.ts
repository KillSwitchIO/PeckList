// Read-side queries: smart views, list contents, date states.

import { isLive } from './collections.ts';
import { addDays, datePart, daysBetween, todayIn } from './dates.ts';
import { compareOrderKeys } from './ordering.ts';
import type { Id, Task, WorkspaceFile } from './types.ts';

export const TRASH_DAYS = 30;

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

/**
 * The date a task belongs to in lists and smart views: its start date. Due dates are shown in
 * the task details and on the calendar, not in lists (Ben, 2026-10-20).
 */
export function startDate(task: Task): string | null {
  return task.schedule ? datePart(task.schedule.start) : null;
}

/** Whether the start date shown on a row is overdue, today, later, or absent. */
export function startState(task: Task, today: string): 'overdue' | 'today' | 'later' | 'none' {
  const date = startDate(task);
  if (!date) return 'none';
  if (task.status === 'open' && date < today) return 'overdue';
  return date === today ? 'today' : 'later';
}

function openTopLevel(workspace: WorkspaceFile): Task[] {
  const liveLists = new Set(workspace.entities.lists.filter(isLive).map((list) => list.id));
  return workspace.entities.tasks.filter(
    (task) =>
      isLive(task) &&
      task.status === 'open' &&
      task.parentId === null &&
      liveLists.has(task.listId),
  );
}

/** By start (date, then time; all-day before timed), then priority, then manual order. */
function byDateThenOrder(a: Task, b: Task): number {
  const left = a.schedule?.start ?? '9999-99-99';
  const right = b.schedule?.start ?? '9999-99-99';
  if (left !== right) return left < right ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return compareOrderKeys(a.order, b.order);
}

/** Open tasks starting today or earlier (overdue included). */
export function todayTasks(workspace: WorkspaceFile, today: string): Task[] {
  return openTopLevel(workspace)
    .filter((task) => {
      const date = startDate(task);
      return date !== null && date <= today;
    })
    .sort(byDateThenOrder);
}

/** Today view groups: overdue (started before today) and today. */
export function todayGroups(
  workspace: WorkspaceFile,
  today: string,
): { overdue: Task[]; today: Task[] } {
  const tasks = todayTasks(workspace, today);
  return {
    overdue: tasks.filter((task) => startDate(task)! < today),
    today: tasks.filter((task) => startDate(task) === today),
  };
}

/** Top-level tasks completed on `today` in `timeZone`, most recent first. */
export function completedOn(workspace: WorkspaceFile, today: string, timeZone: string): Task[] {
  return completedTasks(workspace).filter(
    (task) =>
      task.parentId === null &&
      task.completedAt !== null &&
      todayIn(timeZone, Date.parse(task.completedAt)) === today,
  );
}

/** Open tasks relevant from tomorrow through the next `days` days, grouped by date. */
export function upcomingTasks(
  workspace: WorkspaceFile,
  today: string,
  days = 7,
): { date: string; tasks: Task[] }[] {
  const last = addDays(today, days);
  const groups = new Map<string, Task[]>();
  for (const task of openTopLevel(workspace).sort(byDateThenOrder)) {
    const date = startDate(task);
    if (date && date > today && date <= last) {
      groups.set(date, [...(groups.get(date) ?? []), task]);
    }
  }
  return [...groups.entries()].map(([date, tasks]) => ({ date, tasks }));
}

/** Open top-level tasks of a list, grouped by section (null section first). */
export function listTasks(
  workspace: WorkspaceFile,
  listId: Id,
): { sectionId: Id | null; tasks: Task[] }[] {
  const tasks = openTopLevel(workspace).filter((task) => task.listId === listId);
  const sections = workspace.entities.sections
    .filter((section) => section.listId === listId && isLive(section))
    .sort((a, b) => compareOrderKeys(a.order, b.order));
  const inSection = (sectionId: Id | null) =>
    tasks
      .filter((task) => task.sectionId === sectionId)
      .sort((a, b) => compareOrderKeys(a.order, b.order));
  const known = new Set(sections.map((section) => section.id));
  const orphaned = tasks.filter((task) => task.sectionId !== null && !known.has(task.sectionId));
  return [
    {
      sectionId: null,
      tasks: [...inSection(null), ...orphaned.sort((a, b) => compareOrderKeys(a.order, b.order))],
    },
    ...sections.map((section) => ({ sectionId: section.id, tasks: inSection(section.id) })),
  ];
}

/** Live subtasks of a task in order (any status). */
export function subtasksOf(workspace: WorkspaceFile, parentId: Id): Task[] {
  return workspace.entities.tasks
    .filter((task) => isLive(task) && task.parentId === parentId)
    .sort((a, b) => compareOrderKeys(a.order, b.order));
}

export function subtaskProgress(
  workspace: WorkspaceFile,
  parentId: Id,
): { done: number; total: number } {
  const children = subtasksOf(workspace, parentId);
  return { done: children.filter((task) => task.status !== 'open').length, total: children.length };
}

/** Completed or won't-do tasks, most recent first. */
export function completedTasks(workspace: WorkspaceFile, listId?: Id): Task[] {
  return workspace.entities.tasks
    .filter((task) => isLive(task) && task.status !== 'open' && (!listId || task.listId === listId))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

/** Tasks in the trash for at most TRASH_DAYS, top of each deleted subtree only, newest first. */
export function trashedTasks(workspace: WorkspaceFile, now: number): Task[] {
  const cutoff = new Date(now - TRASH_DAYS * 86_400_000).toISOString();
  const byId = new Map(workspace.entities.tasks.map((task) => [task.id, task]));
  return workspace.entities.tasks
    .filter((task) => {
      if (!task.deletedAt || task.deletedAt < cutoff) return false;
      const parent = task.parentId ? byId.get(task.parentId) : undefined;
      // Hide subtasks that were deleted together with their parent.
      return !(parent && parent.deletedAt === task.deletedAt);
    })
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

/** Count of open top-level tasks per list, for the sidebar. */
export function openCounts(workspace: WorkspaceFile): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const task of openTopLevel(workspace))
    counts.set(task.listId, (counts.get(task.listId) ?? 0) + 1);
  return counts;
}
