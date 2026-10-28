// How many open tasks each built-in view holds, for the counts beside them in the sidebar
// (R-FB-114), worked out as the views pick their tasks; Closed counts what it lists (R-FB-132).
// Calendar, Trash and Search show no count.

import { ALL_TASKS, filterTasks } from './filters.ts';
import { inboxList } from './lists.ts';
import { completedTasks, openCounts, todayGroups, upcomingTasks } from './queries.ts';
import type { Id, WorkspaceFile } from './types.ts';

export function viewCounts(
  workspace: WorkspaceFile,
  today: string,
  me: Id | null,
): Partial<Record<string, number>> {
  const current = todayGroups(workspace, today);
  const now = current.overdue.length + current.today.length;
  const coming = upcomingTasks(workspace, today).reduce((sum, day) => sum + day.tasks.length, 0);
  return {
    today: now,
    inbox: openCounts(workspace).get(inboxList(workspace).id) ?? 0,
    upcoming: now + coming,
    due: filterTasks(workspace, { hasDue: true, closed: false }, today).length,
    all: filterTasks(workspace, ALL_TASKS, today).length,
    completed: completedTasks(workspace).length,
    ...(me
      ? {
          assigned: filterTasks(workspace, { assignedTo: me }, today).length,
          shared: filterTasks(workspace, { sharedWith: me }, today).length,
        }
      : {}),
  };
}
