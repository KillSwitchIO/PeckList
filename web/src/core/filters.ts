// Filter engine. Every task view is a filter (which tasks) plus a grouping (how they show).
// Built-in views are fixed filters; user-made saved filters (PL-015) store a TaskFilter in
// `savedFilters[].query`, so keep it plain JSON and add fields rather than changing them.

import { isLive } from './collections.ts';
import { addDays, datePart, daysBetween } from './dates.ts';
import { members } from './ops.ts';
import { compareOrderKeys } from './ordering.ts';
import { tagWithDescendants } from './tags.ts';
import type { Id, Priority, Task, WorkspaceFile } from './types.ts';

/** Version of the TaskFilter shape, for saved filters. */
export const FILTER_VERSION = 1;

/** Which tasks a view shows. Fields combine with AND; values inside a field with OR. */
export interface TaskFilter {
  /** In any of these lists */
  lists?: Id[];
  /** With any of these tags, or a tag nested under one */
  tags?: Id[];
  /**
   * Start date window in days from today, both ends inclusive; a missing end is open
   * (`{ to: 0 }` is today and everything overdue). Undated tasks never match a window.
   */
  start?: { from?: number; to?: number };
  /** Only tasks with (true) or without (false) a start date */
  dated?: boolean;
  /** Any of these priorities */
  priorities?: Priority[];
  /** Assigned to this user, directly or through a group they are an active member of */
  assignedTo?: Id;
}

/** No conditions: the All view. */
export const ALL_TASKS: TaskFilter = {};

/** The start date a task belongs to in views (due dates show on rows but don't place tasks). */
export function startDate(task: Task): string | null {
  return task.schedule ? datePart(task.schedule.start) : null;
}

/** A predicate for one filter, with the lookups it needs done once. */
export function compileFilter(
  workspace: WorkspaceFile,
  filter: TaskFilter,
  today: string,
): (task: Task) => boolean {
  const lists = filter.lists ? new Set(filter.lists) : null;
  const tags = filter.tags
    ? new Set(
        filter.tags.flatMap((id) => {
          const tag = workspace.entities.tags.find((item) => item.id === id);
          return tag ? tagWithDescendants(workspace, id).map((item) => item.id) : [];
        }),
      )
    : null;
  const from = filter.start?.from === undefined ? null : addDays(today, filter.start.from);
  const to = filter.start?.to === undefined ? null : addDays(today, filter.start.to);
  const priorities = filter.priorities ? new Set(filter.priorities) : null;
  const assignees = filter.assignedTo
    ? new Set([
        `user:${filter.assignedTo}`,
        ...workspace.entities.groupMembers
          .filter(
            (member) =>
              member.deletedAt === null &&
              member.userId === filter.assignedTo &&
              member.state === 'active',
          )
          .map((member) => `group:${member.groupId}`),
      ])
    : null;
  return (task) => {
    if (assignees && !members(task.assignees).some((principal) => assignees.has(principal)))
      return false;
    if (lists && !lists.has(task.listId)) return false;
    if (tags && !members(task.tags).some((id) => tags.has(id))) return false;
    if (priorities && !priorities.has(task.priority)) return false;
    const date = startDate(task);
    if (filter.dated !== undefined && (date !== null) !== filter.dated) return false;
    if (filter.start) {
      if (!date) return false;
      if (from && date < from) return false;
      if (to && date > to) return false;
    }
    return true;
  };
}

/**
 * By start (date, then time; all-day before timed), then priority, then manual order in the
 * task tree (a parent before its subtasks, subtasks in their own order). Undated tasks last.
 */
export function byDateThenOrder(workspace: WorkspaceFile): (a: Task, b: Task) => number {
  const byId = new Map(workspace.entities.tasks.map((task) => [task.id, task]));
  const paths = new Map<Id, string[]>();
  const path = (task: Task): string[] => {
    const known = paths.get(task.id);
    if (known) return known;
    const parent = task.parentId ? byId.get(task.parentId) : undefined;
    const result = [...(parent && parent !== task ? path(parent) : []), task.order];
    paths.set(task.id, result);
    return result;
  };
  return (a, b) => {
    const left = a.schedule?.start ?? '9999-99-99';
    const right = b.schedule?.start ?? '9999-99-99';
    if (left !== right) return left < right ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const x = path(a);
    const y = path(b);
    for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
      const order = compareOrderKeys(x[i]!, y[i]!);
      if (order !== 0) return order;
    }
    return x.length - y.length;
  };
}

function inLiveList(workspace: WorkspaceFile): (task: Task) => boolean {
  const live = new Set(workspace.entities.lists.filter(isLive).map((list) => list.id));
  return (task) => live.has(task.listId);
}

/** Open tasks at any level matching the filter, by start date then manual order. */
export function filterTasks(workspace: WorkspaceFile, filter: TaskFilter, today: string): Task[] {
  const matches = compileFilter(workspace, filter, today);
  const listed = inLiveList(workspace);
  return workspace.entities.tasks
    .filter((task) => isLive(task) && task.status === 'open' && listed(task) && matches(task))
    .sort(byDateThenOrder(workspace));
}

/**
 * Done and won't-do tasks matching the filter, most recent first. A subtask closed together
 * with its parent is left out: the parent stands for it.
 */
export function filterClosedTasks(
  workspace: WorkspaceFile,
  filter: TaskFilter,
  today: string,
): Task[] {
  const matches = compileFilter(workspace, filter, today);
  const listed = inLiveList(workspace);
  const byId = new Map(workspace.entities.tasks.map((task) => [task.id, task]));
  return workspace.entities.tasks
    .filter((task) => {
      if (!isLive(task) || task.status === 'open' || !listed(task) || !matches(task)) return false;
      const parent = task.parentId ? byId.get(task.parentId) : undefined;
      return !(parent && isLive(parent) && parent.status !== 'open');
    })
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

export type DateGroupKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';

export interface DateGroup {
  key: DateGroupKey;
  /** The day, for today and tomorrow */
  date?: string;
  tasks: Task[];
}

const DATE_GROUP_ORDER: DateGroupKey[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];

const on = (date: string): Task['schedule'] => ({
  start: date,
  end: null,
  allDay: true,
  timeZone: 'UTC',
});

export function dateGroupOf(task: Task, today: string): DateGroupKey {
  const date = startDate(task);
  if (!date) return 'none';
  const days = daysBetween(today, date);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return 'week';
  return 'later';
}

/**
 * The date that places a task in date groups: its own start, or for an undated subtask its
 * nearest dated ancestor's (so it stays with the parent it shows under).
 */
export function placingDate(workspace: WorkspaceFile, task: Task): string | null {
  let current: Task | undefined = task;
  const seen = new Set<Id>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const date = startDate(current);
    if (date) return date;
    const parentId: Id | null = current.parentId;
    current = parentId ? workspace.entities.tasks.find((item) => item.id === parentId) : undefined;
  }
  return null;
}

/** Overdue, Today, Tomorrow, Next 7 days, Later, No date: only the non-empty ones, in order. */
export function groupByDate(workspace: WorkspaceFile, tasks: Task[], today: string): DateGroup[] {
  const buckets = new Map<DateGroupKey, Task[]>();
  for (const task of tasks) {
    const date = placingDate(workspace, task);
    const key = date ? dateGroupOf({ ...task, schedule: on(date) }, today) : 'none';
    buckets.set(key, [...(buckets.get(key) ?? []), task]);
  }
  return DATE_GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    ...(key === 'today' ? { date: today } : key === 'tomorrow' ? { date: addDays(today, 1) } : {}),
    tasks: buckets.get(key)!,
  }));
}

/** One group per start date, in date order (tasks must be dated). */
export function groupByDay(tasks: Task[]): { date: string; tasks: Task[] }[] {
  const days = new Map<string, Task[]>();
  for (const task of tasks) {
    const date = startDate(task);
    if (date) days.set(date, [...(days.get(date) ?? []), task]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, items]) => ({ date, tasks: items }));
}
