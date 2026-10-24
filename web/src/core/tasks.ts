// Task operations. Each takes a workspace and returns a new one; every write is HLC-stamped.

import { getEntity, isLive, putEntities, putEntity, requireEntity } from './collections.ts';
import { addDays, datePart, daysBetween } from './dates.ts';
import { compareOrderKeys, keyBetween } from './ordering.ts';
import {
  createEntity,
  isoNow,
  members,
  restore,
  setElement,
  softDelete,
  updateEntity,
  type OpContext,
  type Patch,
} from './ops.ts';
import type {
  DateTime,
  Due,
  Id,
  Priority,
  Schedule,
  Task,
  TaskStatus,
  WorkspaceFile,
} from './types.ts';

export interface TaskInput {
  title: string;
  listId: Id;
  parentId?: Id | null;
  /** `user:<id>` / `group:<id>` principals to assign it to from the start. */
  assignees?: string[];
  notes?: string;
  priority?: Priority;
  schedule?: Schedule | null;
  due?: Due | null;
  tags?: Id[];
  /** Place directly after this sibling instead of at the end */
  afterId?: Id | null;
}

/** Subtask levels below a top-level task (R-TASK-03 asks for at least 3). */
export const MAX_SUBTASK_DEPTH = 5;

/** Live siblings in display order: same list and parent. (Sections were dropped: PL-011.) */
export function siblings(workspace: WorkspaceFile, listId: Id, parentId: Id | null): Task[] {
  return workspace.entities.tasks
    .filter(
      (task) =>
        isLive(task) &&
        task.listId === listId &&
        (parentId ? task.parentId === parentId : task.parentId === null),
    )
    .sort((a, b) => compareOrderKeys(a.order, b.order));
}

/** All live descendants of a task, depth first. */
export function descendants(workspace: WorkspaceFile, id: Id, includeDeleted = false): Task[] {
  const result: Task[] = [];
  const visit = (parentId: Id) => {
    for (const task of workspace.entities.tasks) {
      if (task.parentId === parentId && (includeDeleted || isLive(task))) {
        result.push(task);
        visit(task.id);
      }
    }
  };
  visit(id);
  return result;
}

function lastOrder(tasks: Task[]): string | null {
  return tasks.length ? tasks[tasks.length - 1]!.order : null;
}

/** Live ancestors, top-level task first, direct parent last. */
export function ancestors(workspace: WorkspaceFile, id: Id): Task[] {
  const chain: Task[] = [];
  let current = getEntity(workspace, 'tasks', id);
  const seen = new Set<Id>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = getEntity(workspace, 'tasks', current.parentId);
    if (!parent || !isLive(parent)) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/** How many levels below the top a task sits: 0 for a top-level task. */
export function taskDepth(workspace: WorkspaceFile, id: Id): number {
  return ancestors(workspace, id).length;
}

/** Levels of live subtasks under a task: 0 without subtasks. */
export function subtreeHeight(workspace: WorkspaceFile, id: Id): number {
  let height = 0;
  for (const child of workspace.entities.tasks) {
    if (child.parentId === id && isLive(child)) {
      height = Math.max(height, 1 + subtreeHeight(workspace, child.id));
    }
  }
  return height;
}

/** The sibling just above a task, which an indent would nest it under. */
function previousSibling(workspace: WorkspaceFile, task: Task): Task | undefined {
  const peers = siblings(workspace, task.listId, task.parentId);
  const index = peers.findIndex((peer) => peer.id === task.id);
  return index > 0 ? peers[index - 1] : undefined;
}

export function canIndent(workspace: WorkspaceFile, id: Id): boolean {
  const task = requireEntity(workspace, 'tasks', id);
  const above = previousSibling(workspace, task);
  if (!above) return false;
  return taskDepth(workspace, above.id) + 1 + subtreeHeight(workspace, id) <= MAX_SUBTASK_DEPTH;
}

/** Nest a task (with its subtasks) under the sibling above it, as that sibling's last subtask. */
export function indentTask(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  if (!canIndent(workspace, id)) return workspace;
  const task = requireEntity(workspace, 'tasks', id);
  const above = previousSibling(workspace, task)!;
  return moveTask(ctx, workspace, id, { listId: task.listId, parentId: above.id });
}

/** Whether a task (with its subtasks) can become a subtask of `parentId`. */
export function canNestUnder(workspace: WorkspaceFile, id: Id, parentId: Id): boolean {
  if (id === parentId) return false;
  const parent = getEntity(workspace, 'tasks', parentId);
  const task = getEntity(workspace, 'tasks', id);
  if (!parent || !task || !isLive(parent) || parent.status !== 'open') return false;
  if (task.parentId === parentId) return false;
  if (descendants(workspace, id).some((child) => child.id === parentId)) return false;
  return taskDepth(workspace, parentId) + 1 + subtreeHeight(workspace, id) <= MAX_SUBTASK_DEPTH;
}

/** Make a task (with its subtasks) the last subtask of another task, in that task's list. */
export function nestUnder(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  parentId: Id,
): WorkspaceFile {
  if (!canNestUnder(workspace, id, parentId)) throw new Error('cannot nest the task there');
  const parent = requireEntity(workspace, 'tasks', parentId);
  return moveTask(ctx, workspace, id, { listId: parent.listId, parentId });
}

/** Take a subtask out of its parents: it becomes a top-level task right after its old top task. */
export function detachTask(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  requireEntity(workspace, 'tasks', id);
  const top = ancestors(workspace, id)[0];
  if (!top) return workspace;
  return moveTask(ctx, workspace, id, {
    listId: top.listId,
    parentId: null,
    afterId: top.id,
  });
}

/** Move a subtask up a level, directly after its old parent. */
export function outdentTask(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  if (!task.parentId) return workspace;
  const parent = requireEntity(workspace, 'tasks', task.parentId);
  return moveTask(ctx, workspace, id, {
    listId: parent.listId,
    parentId: parent.parentId,
    afterId: parent.id,
  });
}

export function createTask(
  ctx: OpContext,
  workspace: WorkspaceFile,
  input: TaskInput,
): { workspace: WorkspaceFile; task: Task } {
  const parent = input.parentId ? requireEntity(workspace, 'tasks', input.parentId) : null;
  const listId = parent?.listId ?? input.listId;
  const parentId = parent?.id ?? null;
  if (parent && taskDepth(workspace, parent.id) + 1 > MAX_SUBTASK_DEPTH) {
    throw new Error('subtasks are nested too deep');
  }
  const peers = siblings(workspace, listId, parentId);
  const afterIndex = input.afterId ? peers.findIndex((peer) => peer.id === input.afterId) : -1;
  const order =
    afterIndex >= 0
      ? keyBetween(peers[afterIndex]!.order, peers[afterIndex + 1]?.order ?? null)
      : keyBetween(lastOrder(peers), null);
  let tags = {};
  // A subtask starts with its parent's tags (its list comes from the parent too).
  const tagIds = new Set([...(input.tags ?? []), ...(parent ? members(parent.tags) : [])]);
  for (const tag of tagIds) tags = setElement(ctx, tags, tag, true);
  const task = createEntity<Task>(ctx, {
    title: input.title.trim(),
    notes: input.notes ?? '',
    listId,
    sectionId: null,
    parentId,
    order,
    status: 'open',
    completedAt: null,
    completedBy: null,
    priority: input.priority ?? 0,
    schedule: input.schedule ?? null,
    due: input.due ?? null,
    tags,
    assignees: (input.assignees ?? []).reduce(
      (set, principal) => setElement(ctx, set, principal, true),
      {} as Task['assignees'],
    ),
    blockedBy: {},
    recurrence: null,
    progress: 0,
  });
  return { workspace: putEntity(workspace, 'tasks', task), task };
}

export function updateTask(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  patch: Patch<Task>,
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  return putEntity(workspace, 'tasks', updateEntity(ctx, task, patch));
}

/** Progress steps: 0 (none) to 100 percent, by 10. */
export const PROGRESS_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/**
 * Set how far along a task is, rounded to the nearest 10 percent (0 clears it). Reaching 100
 * completes an open task.
 */
export function setTaskProgress(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  percent: number,
): WorkspaceFile {
  const progress = Math.min(100, Math.max(0, Math.round(percent / 10) * 10));
  const updated = updateTask(ctx, workspace, id, { progress });
  return progress === 100 && requireEntity(updated, 'tasks', id).status === 'open'
    ? setTaskStatus(ctx, updated, id, 'done')
    : updated;
}

/**
 * Set a task's status. Completing a task also completes its open subtasks and stamps the
 * completion date, unless one is already set (users can set it themselves). Reopening clears it.
 */
export function setTaskStatus(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  status: TaskStatus,
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  const closing = status !== 'open';
  const stamp = (target: Task, next: TaskStatus) =>
    updateEntity(ctx, target, {
      status: next,
      completedAt: next === 'open' ? null : (target.completedAt ?? isoNow(ctx)),
      completedBy: next === 'open' ? null : (target.completedBy ?? ctx.userId),
      // Done is done: a pinned task lets go of the top (reopening does not pin it again).
      ...(next !== 'open' && target.pinnedAt ? { pinnedAt: null } : {}),
    });
  const changed = [stamp(task, status)];
  if (closing) {
    for (const child of descendants(workspace, id)) {
      if (child.status === 'open') changed.push(stamp(child, status));
    }
  }
  return putEntities(workspace, 'tasks', changed);
}

/**
 * Set or clear the completion date (an instant). Setting it on an open task completes the task
 * (with its open subtasks) on that date; clearing it on a done or won't-do task reopens it.
 */
export function setCompletedAt(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  at: DateTime | null,
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  if (at === null && task.status !== 'open') return setTaskStatus(ctx, workspace, id, 'open');
  const dated = updateTask(ctx, workspace, id, { completedAt: at });
  // Completing keeps the date just set (it only fills an empty one).
  return at !== null && task.status === 'open' ? setTaskStatus(ctx, dated, id, 'done') : dated;
}

export function toggleTaskDone(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  return setTaskStatus(ctx, workspace, id, task.status === 'open' ? 'done' : 'open');
}

/** Move to the trash with all subtasks. */
export function deleteTask(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  const all = [task, ...descendants(workspace, id)];
  const at = isoNow(ctx);
  return putEntities(
    workspace,
    'tasks',
    all.map((target) => softDelete(ctx, target, at)),
  );
}

/** Restore from the trash, with the subtasks that were deleted together with it. */
export function restoreTask(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  if (task.deletedAt === null) return workspace;
  const together = descendants(workspace, id, true).filter(
    (child) => child.deletedAt === task.deletedAt,
  );
  let next = putEntities(
    workspace,
    'tasks',
    [task, ...together].map((target) => restore(ctx, target)),
  );
  // A restored subtask whose parent is still in the trash moves to the top level.
  if (task.parentId) {
    const parent = getEntity(next, 'tasks', task.parentId);
    if (!parent || !isLive(parent)) next = updateTask(ctx, next, id, { parentId: null });
  }
  return next;
}

export interface MoveTarget {
  listId: Id;
  parentId?: Id | null;
  /** Place directly before this sibling; null or omitted with `afterId` omitted means the end. */
  beforeId?: Id | null;
  afterId?: Id | null;
}

/** Move a task (and its subtree) to a new list, parent and position. */
export function moveTask(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  target: MoveTarget,
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  const parentId = target.parentId ?? null;
  if (
    parentId === id ||
    (parentId && descendants(workspace, id).some((child) => child.id === parentId))
  ) {
    throw new Error('cannot move a task inside itself');
  }
  const parent = parentId ? requireEntity(workspace, 'tasks', parentId) : null;
  const listId = parent?.listId ?? target.listId;
  const peers = siblings(workspace, listId, parentId).filter((peer) => peer.id !== id);

  let before: string | null;
  let after: string | null;
  if (target.beforeId) {
    const index = peers.findIndex((peer) => peer.id === target.beforeId);
    if (index < 0) throw new Error(`sibling ${target.beforeId} not found`);
    after = peers[index]!.order;
    before = index > 0 ? peers[index - 1]!.order : null;
  } else if (target.afterId) {
    const index = peers.findIndex((peer) => peer.id === target.afterId);
    if (index < 0) throw new Error(`sibling ${target.afterId} not found`);
    before = peers[index]!.order;
    after = index < peers.length - 1 ? peers[index + 1]!.order : null;
  } else {
    before = lastOrder(peers);
    after = null;
  }

  // Nesting under a new parent adds the parent's tags, as if created there.
  const inherit = (target: Task): Task => {
    if (!parent || parent.id === task.parentId) return target;
    let tags = target.tags;
    for (const tag of members(parent.tags)) tags = setElement(ctx, tags, tag, true);
    return tags === target.tags ? target : { ...target, tags };
  };
  const moved = inherit(
    updateEntity(ctx, task, {
      listId,
      sectionId: null,
      parentId,
      order: keyBetween(before, after),
    }),
  );
  // Subtasks always follow their root task's list.
  const subtree = descendants(workspace, id).map((child) =>
    inherit(updateEntity(ctx, child, { listId, sectionId: null })),
  );
  return putEntities(workspace, 'tasks', [moved, ...subtree]);
}

export function setTaskTag(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  tagId: Id,
  present: boolean,
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  const tags = setElement(ctx, task.tags, tagId, present);
  return tags === task.tags ? workspace : putEntity(workspace, 'tasks', { ...task, tags });
}

/** Move tasks to start on `date`, keeping each task's time of day and range length. */
export function rescheduleTo(
  ctx: OpContext,
  workspace: WorkspaceFile,
  ids: Id[],
  date: string,
): WorkspaceFile {
  const changed = ids.map((id) => {
    const task = requireEntity(workspace, 'tasks', id);
    if (!task.schedule) return task;
    const shift = daysBetween(datePart(task.schedule.start), date);
    const move = (value: string) => addDays(datePart(value), shift) + value.slice(10);
    return updateEntity(ctx, task, {
      schedule: {
        ...task.schedule,
        start: move(task.schedule.start),
        end: task.schedule.end ? move(task.schedule.end) : null,
      },
    });
  });
  return putEntities(workspace, 'tasks', changed);
}

/**
 * When a task (or any entity) last changed: the newest of its field clocks, which start with the
 * time of the write. Falls back to when it was made.
 */
export function lastChangedAt(entity: { createdAt: string; _hlc: Record<string, string> }): string {
  let latest = entity.createdAt;
  for (const clock of Object.values(entity._hlc)) {
    const at = clock.slice(0, 24);
    if (at > latest) latest = at;
  }
  return latest;
}

/** Whether a task shows in its views' Pinned group: an open top-level task someone pinned. */
export function isPinned(task: Task): boolean {
  return Boolean(task.pinnedAt) && task.status === 'open' && task.parentId === null;
}

/** Pin a top-level task to the top of its views, or let it go (spec: PL-089). */
export function setPinned(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  pinned: boolean,
): WorkspaceFile {
  const task = requireEntity(workspace, 'tasks', id);
  if (pinned === isPinned(task) || (pinned && task.parentId !== null)) return workspace;
  return putEntity(
    workspace,
    'tasks',
    updateEntity(ctx, task, { pinnedAt: pinned ? isoNow(ctx) : null }),
  );
}

/** A view's tasks split: the pinned ones (oldest pin first) and the rest, in their order. */
export function pinnedFirst(tasks: readonly Task[]): { pinned: Task[]; rest: Task[] } {
  const pinned = tasks
    .filter(isPinned)
    .sort((a, b) => (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? ''));
  return {
    pinned,
    rest: pinned.length === 0 ? [...tasks] : tasks.filter((task) => !isPinned(task)),
  };
}
