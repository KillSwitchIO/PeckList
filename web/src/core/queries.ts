// Read-side queries: smart views, list contents, date states.

import { purgeDaysOf } from './settings.ts';
import { isLive } from './collections.ts';
import { daysBetween, localDayOf } from './dates.ts';
import {
  ALL_TASKS,
  compileFilter,
  filterClosedTasks,
  filterTasks,
  groupByDay,
  inLiveList,
  placeDate,
  type TaskFilter,
} from './filters.ts';
import { compareByOrder } from './ordering.ts';
import { visibleTags } from './tags.ts';
import type { Id, Task, WorkspaceFile } from './types.ts';

/** Built-in date views. Neither shows undated tasks. */
export const TODAY_FILTER: TaskFilter = { start: { to: 0 } };
export const NEXT_7_DAYS_FILTER: TaskFilter = { start: { to: 7 } };

export { dateState, type DateState } from './dateState.ts';

// The date a task belongs to in views is its start date (filters.ts); due dates show in the
// task details and on the calendar, not in lists (Ben, 2026-10-20).
export { startDate } from './filters.ts';

/** Whether the start date shown on a row is overdue, today, later, or absent. */
export function startState(task: Task, today: string): 'overdue' | 'today' | 'later' | 'none' {
  // A span still running is today's, not overdue, until its end has passed.
  const date = placeDate(task, today);
  if (!date) return 'none';
  if (task.status === 'open' && date < today) return 'overdue';
  return date === today ? 'today' : 'later';
}

function openTopLevel(workspace: WorkspaceFile): Task[] {
  const listed = inLiveList(workspace);
  return workspace.entities.tasks.filter(
    (task) => isLive(task) && task.status === 'open' && task.parentId === null && listed(task),
  );
}

/** Open tasks starting today or earlier (overdue included). */
export function todayTasks(workspace: WorkspaceFile, today: string): Task[] {
  return filterTasks(workspace, TODAY_FILTER, today);
}

/** Open tasks starting on `date`, any day (spec: PL-090, a day picked in the mini calendar). */
export function dayTasks(workspace: WorkspaceFile, date: string, today: string): Task[] {
  const offset = daysBetween(today, date);
  return filterTasks(workspace, { start: { from: offset, to: offset } }, today);
}

/**
 * Today view groups: overdue (started before today) and today. A task spanning days is today's
 * while it runs, and overdue only once its end has passed.
 */
export function todayGroups(
  workspace: WorkspaceFile,
  today: string,
): { overdue: Task[]; today: Task[] } {
  const tasks = todayTasks(workspace, today);
  return {
    overdue: tasks.filter((task) => placeDate(task, today)! < today),
    today: tasks.filter((task) => placeDate(task, today) === today),
  };
}

/**
 * Open pinned tasks with no start date. The date views (Today, Upcoming) never list undated
 * tasks, but a pin means "keep this in front of me", so these join their Pinned group.
 */
export function undatedPinned(workspace: WorkspaceFile, today: string): Task[] {
  return filterTasks(workspace, { dated: false }, today).filter((task) => Boolean(task.pinnedAt));
}

/** Top-level tasks completed on `today` in `timeZone`, most recent first. */
export function completedOn(workspace: WorkspaceFile, today: string, timeZone: string): Task[] {
  return completedTasks(workspace).filter(
    (task) =>
      task.parentId === null &&
      task.completedAt !== null &&
      localDayOf(task.completedAt, timeZone) === today,
  );
}

/** Open tasks relevant from tomorrow through the next `days` days, grouped by date. */
export function upcomingTasks(
  workspace: WorkspaceFile,
  today: string,
  days = 7,
): { date: string; tasks: Task[] }[] {
  return groupByDay(filterTasks(workspace, { start: { from: 1, to: days } }, today));
}

/** Open top-level tasks of a list, in the list's own order. */
export function listTasks(workspace: WorkspaceFile, listId: Id): Task[] {
  return openTopLevel(workspace)
    .filter((task) => task.listId === listId)
    .sort(compareByOrder);
}

/** Live subtasks of a task in order (any status). */
/** Live tasks by parent, each in order: built once per tasks array (workspaces are immutable). */
const childrenCache = new WeakMap<readonly Task[], { length: number; byParent: Map<Id, Task[]> }>();

function childrenByParent(tasks: readonly Task[]): Map<Id, Task[]> {
  let cached = childrenCache.get(tasks);
  if (!cached || cached.length !== tasks.length) {
    const byParent = new Map<Id, Task[]>();
    for (const task of tasks) {
      if (!isLive(task) || task.parentId === null) continue;
      const siblings = byParent.get(task.parentId);
      if (siblings) siblings.push(task);
      else byParent.set(task.parentId, [task]);
    }
    for (const siblings of byParent.values()) siblings.sort(compareByOrder);
    cached = { length: tasks.length, byParent };
    childrenCache.set(tasks, cached);
  }
  return cached.byParent;
}

export function subtasksOf(workspace: WorkspaceFile, parentId: Id): Task[] {
  return [...(childrenByParent(workspace.entities.tasks).get(parentId) ?? [])];
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

/** Tasks still in the trash (see purgeDaysOf), top of each deleted subtree only, newest first. */
export function trashedTasks(workspace: WorkspaceFile, now: number): Task[] {
  const cutoff = new Date(now - purgeDaysOf(workspace) * 86_400_000).toISOString();
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

/** Open tasks (any level) carrying a tag or one nested under it, by start date. */
export function tagTasks(workspace: WorkspaceFile, tagId: Id): Task[] {
  // `today` only matters for start windows, which a tag filter has none of.
  return filterTasks(workspace, { tags: [tagId] }, '');
}

/** Closed tasks carrying a tag or one nested under it, most recent first (see filterClosedTasks). */
export function completedTagTasks(workspace: WorkspaceFile, tagId: Id): Task[] {
  return filterClosedTasks(workspace, { tags: [tagId] }, '');
}

/** Open task count per tag, nested tags and subtasks included (matches the tag's view). */
export function openTagCounts(workspace: WorkspaceFile): Map<Id, number> {
  const counts = new Map<Id, number>();
  const open = filterTasks(workspace, ALL_TASKS, '');
  for (const tag of visibleTags(workspace)) {
    const matches = compileFilter(workspace, { tags: [tag.id] }, '');
    counts.set(tag.id, open.filter(matches).length);
  }
  return counts;
}

export interface SubtaskNode {
  task: Task;
  /** 0 for a direct subtask of the root */
  depth: number;
  hasChildren: boolean;
}

/** A task's subtasks as a flattened tree in display order. */
export function subtaskTree(
  workspace: WorkspaceFile,
  rootId: Id,
  options: { openOnly?: boolean } = {},
): SubtaskNode[] {
  const out: SubtaskNode[] = [];
  const children = (parentId: Id) =>
    subtasksOf(workspace, parentId).filter((task) => !options.openOnly || task.status === 'open');
  const walk = (parentId: Id, depth: number) => {
    for (const task of children(parentId)) {
      const below = children(task.id);
      out.push({ task, depth, hasChildren: below.length > 0 });
      walk(task.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}
