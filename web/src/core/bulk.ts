// Changing many picked tasks at once (spec: R-FB-55), like TickTick's multi-select bar: complete,
// date, move, tag, priority, pin, delete. Tasks the person may not edit are passed over, and a
// task whose parent is picked too goes with its parent where that matters (move, delete).

import { requireEntity } from './collections.ts';
import { datePart } from './dates.ts';
import { members, type OpContext } from './ops.ts';
import { canEditTask } from './sharing.ts';
import {
  ancestors,
  deleteTask,
  isPinned,
  moveTask,
  rescheduleTo,
  setPinned,
  setTaskStatus,
  setTaskTag,
  updateTask,
} from './tasks.ts';
import type { Id, Priority, WorkspaceFile } from './types.ts';

/** The picked tasks that are still there and editable. */
function editable(ctx: OpContext, workspace: WorkspaceFile, ids: readonly Id[]): Id[] {
  return ids.filter((id) => {
    const task = workspace.entities.tasks.find((each) => each.id === id);
    return task && !task.deletedAt && canEditTask(workspace, ctx.userId, task);
  });
}

/** Leave out tasks whose parent (or any ancestor) is picked too: they go along with it. */
function tops(workspace: WorkspaceFile, ids: readonly Id[]): Id[] {
  const picked = new Set(ids);
  return ids.filter((id) => !ancestors(workspace, id).some((above) => picked.has(above.id)));
}

const each = (
  workspace: WorkspaceFile,
  ids: readonly Id[],
  change: (ws: WorkspaceFile, id: Id) => WorkspaceFile,
) => ids.reduce(change, workspace);

export function completeTasks(ctx: OpContext, workspace: WorkspaceFile, ids: readonly Id[]) {
  return each(workspace, editable(ctx, workspace, ids), (ws, id) =>
    requireEntity(ws, 'tasks', id).status === 'open' ? setTaskStatus(ctx, ws, id, 'done') : ws,
  );
}

/**
 * Start the tasks on `date` (each keeps its time of day and length; an undated one becomes all
 * day), or with null take their dates away.
 */
export function dateTasks(
  ctx: OpContext,
  workspace: WorkspaceFile,
  ids: readonly Id[],
  date: string | null,
  timeZone: string,
) {
  const mine = editable(ctx, workspace, ids);
  if (date === null)
    return each(workspace, mine, (ws, id) => updateTask(ctx, ws, id, { schedule: null }));
  const dated = mine.filter((id) => requireEntity(workspace, 'tasks', id).schedule);
  const undated = mine.filter((id) => !requireEntity(workspace, 'tasks', id).schedule);
  const moved = rescheduleTo(ctx, workspace, dated, datePart(date));
  return each(moved, undated, (ws, id) =>
    updateTask(ctx, ws, id, { schedule: { start: date, end: null, allDay: true, timeZone } }),
  );
}

export function moveTasks(
  ctx: OpContext,
  workspace: WorkspaceFile,
  ids: readonly Id[],
  listId: Id,
) {
  return each(workspace, tops(workspace, editable(ctx, workspace, ids)), (ws, id) =>
    requireEntity(ws, 'tasks', id).listId === listId && !requireEntity(ws, 'tasks', id).parentId
      ? ws
      : moveTask(ctx, ws, id, { listId, parentId: null }),
  );
}

export function prioritizeTasks(
  ctx: OpContext,
  workspace: WorkspaceFile,
  ids: readonly Id[],
  priority: Priority,
) {
  return each(workspace, editable(ctx, workspace, ids), (ws, id) =>
    updateTask(ctx, ws, id, { priority }),
  );
}

/** Tag them all, or (when every one has it already) take the tag off them all. */
export function toggleTagOnTasks(
  ctx: OpContext,
  workspace: WorkspaceFile,
  ids: readonly Id[],
  tagId: Id,
) {
  const mine = editable(ctx, workspace, ids);
  const all = mine.every((id) =>
    members(requireEntity(workspace, 'tasks', id).tags).includes(tagId),
  );
  return each(workspace, mine, (ws, id) => setTaskTag(ctx, ws, id, tagId, !all));
}

/** Pin them all, or (when every one is pinned already) unpin them all. */
export function togglePinOnTasks(ctx: OpContext, workspace: WorkspaceFile, ids: readonly Id[]) {
  const mine = editable(ctx, workspace, ids);
  const all = mine.every((id) => isPinned(requireEntity(workspace, 'tasks', id)));
  return each(workspace, mine, (ws, id) => setPinned(ctx, ws, id, !all));
}

export function deleteTasks(ctx: OpContext, workspace: WorkspaceFile, ids: readonly Id[]) {
  return each(workspace, tops(workspace, editable(ctx, workspace, ids)), (ws, id) =>
    deleteTask(ctx, ws, id),
  );
}
