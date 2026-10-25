// Narrowing a view (spec: R-FB-53): Today, Upcoming and the calendar can show just some lists,
// tags and saved filters, in any mix. Within each kind, any one picked will do (OR); across kinds,
// all must hold (AND). Nothing picked in a kind leaves that kind open.

import { compileFilter } from './filters.ts';
import { filterOf } from './savedFilters.ts';
import type { Id, Task, WorkspaceFile } from './types.ts';

export interface Narrowing {
  lists: Id[];
  tags: Id[];
  filters: Id[];
}

export const NO_NARROWING: Narrowing = { lists: [], tags: [], filters: [] };

export const isNarrowed = (narrowing: Narrowing) =>
  narrowing.lists.length + narrowing.tags.length + narrowing.filters.length > 0;

/** Whether a task shows under `narrowing`; picks that no longer exist are passed over. */
export function narrowingMatcher(
  workspace: WorkspaceFile,
  narrowing: Narrowing,
  today: string,
): (task: Task) => boolean {
  const lists = narrowing.lists.filter((id) =>
    workspace.entities.lists.some((list) => list.id === id && !list.deletedAt),
  );
  const tags = narrowing.tags.filter((id) =>
    workspace.entities.tags.some((tag) => tag.id === id && !tag.deletedAt),
  );
  const saved = workspace.entities.savedFilters.filter(
    (each) => !each.deletedAt && narrowing.filters.includes(each.id),
  );
  const inLists = lists.length ? new Set(lists) : null;
  const tagged = tags.length ? compileFilter(workspace, { tags }, today) : null;
  const filters = saved.map((each) => compileFilter(workspace, filterOf(each), today));
  return (task) =>
    (!inLists || inLists.has(task.listId)) &&
    (!tagged || tagged(task)) &&
    (filters.length === 0 || filters.some((matches) => matches(task)));
}

/** The workspace with only the tasks `narrowing` lets through (everything else as it is). */
export function narrowWorkspace(
  workspace: WorkspaceFile,
  narrowing: Narrowing,
  today: string,
): WorkspaceFile {
  if (!isNarrowed(narrowing)) return workspace;
  const shows = narrowingMatcher(workspace, narrowing, today);
  return {
    ...workspace,
    entities: { ...workspace.entities, tasks: workspace.entities.tasks.filter(shows) },
  };
}
