// Dragging a task into another group of a view (spec: PL-014, R-FB-58): each group stands for a
// value, and a task dropped into it takes that value. Date groups set the start date (a task
// already within a span-of-days group keeps its date), priority groups the priority, tag groups
// swap the tag the task was dragged out of for the new one, list groups move it to that list.

import { requireEntity } from './collections.ts';
import { dateTasks, moveTasks } from './bulk.ts';
import { datePart } from './dates.ts';
import type { OpContext } from './ops.ts';
import { isPinned, setPinned, setTaskTag, updateTask } from './tasks.ts';
import type { Id, Priority, WorkspaceFile } from './types.ts';

export type GroupKind = 'date' | 'priority' | 'tag' | 'list' | 'pin';

/** A group as a drop target: `value` is a date (or "none"), a priority, a tag id (or "none"), a list id. */
export interface GroupTarget {
  kind: GroupKind;
  value: string;
  /** Date groups covering days: the last one (a task dated within keeps its date) */
  until?: string;
}

/** Drop `taskId` into `target`, out of `from` (the group it was dragged from). `timeZone` dates an undated task. */
export function dropIntoGroup(
  ctx: OpContext,
  workspace: WorkspaceFile,
  taskId: Id,
  target: GroupTarget,
  from: GroupTarget | undefined,
  timeZone: string,
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', taskId);
  switch (target.kind) {
    case 'date': {
      if (target.value === 'none') {
        return task.schedule ? updateTask(ctx, workspace, taskId, { schedule: null }) : workspace;
      }
      const date = task.schedule ? datePart(task.schedule.start) : null;
      const last = target.until ?? target.value;
      if (date && date >= target.value && date <= last) return workspace;
      return dateTasks(ctx, workspace, [taskId], target.value, task.schedule?.timeZone ?? timeZone);
    }
    case 'priority': {
      const priority = Number(target.value) as Priority;
      return task.priority === priority
        ? workspace
        : updateTask(ctx, workspace, taskId, { priority });
    }
    case 'tag': {
      if (from?.kind === 'tag' && from.value === target.value) return workspace;
      let next = workspace;
      if (from?.kind === 'tag' && from.value !== 'none')
        next = setTaskTag(ctx, next, taskId, from.value, false);
      if (target.value !== 'none') next = setTaskTag(ctx, next, taskId, target.value, true);
      return next;
    }
    case 'pin':
      return isPinned(task) ? workspace : setPinned(ctx, workspace, taskId, true);
    case 'list':
      return task.listId === target.value && !task.parentId
        ? workspace
        : moveTasks(ctx, workspace, [taskId], target.value);
  }
}

/** A pinned task dragged out of Pinned (anywhere but back into it) is unpinned. */
export function leavingPinned(
  ctx: OpContext,
  workspace: WorkspaceFile,
  taskId: Id,
  from: GroupTarget | undefined,
): WorkspaceFile {
  if (from?.kind !== 'pin') return workspace;
  const task = workspace.entities.tasks.find((each) => each.id === taskId);
  return task && isPinned(task) ? setPinned(ctx, workspace, taskId, false) : workspace;
}
