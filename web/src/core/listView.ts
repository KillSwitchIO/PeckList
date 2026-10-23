// How a list's tasks are grouped and sorted on its page (spec: Views, list sort and group options).

import { isLive } from './collections.ts';
import { datePart } from './dates.ts';
import { members } from './ops.ts';
import { compareOrderKeys } from './ordering.ts';
import type { Id, Priority, Task, WorkspaceFile } from './types.ts';

export type ListGrouping = 'date' | 'section' | 'priority' | 'tag' | 'none';
export type ListSort = 'manual' | 'date' | 'priority' | 'title' | 'created';

export const LIST_GROUPINGS: readonly ListGrouping[] = [
  'date',
  'section',
  'priority',
  'tag',
  'none',
];
export const LIST_SORTS: readonly ListSort[] = ['manual', 'date', 'priority', 'title', 'created'];

/** The day a task is placed on for sorting: its start, else its due date; null when undated. */
export function sortDate(task: Task): string | null {
  if (task.schedule) return datePart(task.schedule.start);
  if (task.due) return datePart(task.due.at);
  return null;
}

const byOrder = (a: Task, b: Task) => compareOrderKeys(a.order, b.order);
const byPriority = (a: Task, b: Task) => b.priority - a.priority;
const byDate = (a: Task, b: Task) => {
  const left = sortDate(a) ?? '9999-99-99';
  const right = sortDate(b) ?? '9999-99-99';
  return left === right ? 0 : left < right ? -1 : 1;
};
const titles = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** The tasks in the chosen order (a new array). Ties keep the list's own order. */
export function sortTasks(tasks: readonly Task[], sort: ListSort): Task[] {
  const compare: ((a: Task, b: Task) => number)[] = {
    manual: [byOrder],
    date: [byDate, byPriority, byOrder],
    priority: [byPriority, byDate, byOrder],
    title: [(a: Task, b: Task) => titles.compare(a.title, b.title), byOrder],
    // Newest first.
    created: [(a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt), byOrder],
  }[sort];
  return [...tasks].sort((a, b) => {
    for (const each of compare) {
      const order = each(a, b);
      if (order !== 0) return order;
    }
    return 0;
  });
}

export interface TaskGroup {
  /** `priority:3`, `tag:<id>`, `tag:none`. */
  key: string;
  /** The tag's name; priorities are named by the app. */
  name?: string;
  priority?: Priority;
  tasks: Task[];
}

/** High to none; empty priorities are left out. */
export function groupByPriority(tasks: readonly Task[]): TaskGroup[] {
  return ([3, 2, 1, 0] as const).flatMap((priority) => {
    const found = tasks.filter((task) => task.priority === priority);
    return found.length === 0 ? [] : [{ key: `priority:${priority}`, priority, tasks: found }];
  });
}

/**
 * One group per tag in the tags' own order, then "no tags". A task with two tags is in both
 * groups, as in TickTick.
 */
export function groupByTag(workspace: WorkspaceFile, tasks: readonly Task[]): TaskGroup[] {
  const tags = workspace.entities.tags
    .filter((tag) => isLive(tag))
    .sort((a, b) => compareOrderKeys(a.order, b.order));
  const known = new Set<Id>(tags.map((tag) => tag.id));
  const groups: TaskGroup[] = tags.flatMap((tag) => {
    const found = tasks.filter((task) => members(task.tags).includes(tag.id));
    return found.length === 0 ? [] : [{ key: `tag:${tag.id}`, name: tag.name, tasks: found }];
  });
  const untagged = tasks.filter((task) => !members(task.tags).some((id) => known.has(id)));
  return untagged.length === 0 ? groups : [...groups, { key: 'tag:none', tasks: untagged }];
}
