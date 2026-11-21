// Duplicating tasks and lists (spec: PL-139). A copy is ordinary creates, so it syncs and goes
// through the server's checks like any new task; the copy rules live here and nowhere else.

import { isLive, putEntity, requireEntity } from './collections.ts';
import { addAttachment, attachmentsOf } from './attachments.ts';
import { createList } from './lists.ts';
import { members, type OpContext } from './ops.ts';
import { ancestors, createTask, setTaskTag, siblings, updateTask } from './tasks.ts';
import type { Id, List, Task, WorkspaceFile } from './types.ts';

interface CopyOptions {
  listId: Id;
  parentId: Id | null;
  afterId: Id | null;
  /** Which assignees go along (a copy into a new private list keeps only me) */
  keepAssignee: (principal: string) => boolean;
}

/**
 * A copy of `original` and its live subtasks, all open: title, notes, priority, tags, dates,
 * reminders, recurrence, assignees and its files (linked: the same stored file, nothing uploaded).
 * Not its done state, comments, history, pin, progress or blocked-by links.
 */
function copyTree(
  ctx: OpContext,
  workspace: WorkspaceFile,
  source: WorkspaceFile,
  original: Task,
  options: CopyOptions,
): { workspace: WorkspaceFile; task: Task } {
  const made = createTask(ctx, workspace, {
    title: original.title,
    listId: options.listId,
    parentId: options.parentId,
    afterId: options.afterId,
    notes: original.notes,
    priority: original.priority,
    schedule: original.schedule,
    due: original.due,
    tags: members(original.tags),
    reminders: original.reminders ?? [],
    recurrence: original.recurrence,
  });
  // The people on it, as they were assigned there (their stamps kept): the server sees an
  // assignment older than the copy and tells no one (Ben, 2026-11-21: a copy's people are not
  // notified, so a bulk copy doesn't send a notice per task per person).
  const carried = Object.fromEntries(
    Object.entries(original.assignees).filter(
      ([principal, state]) => state.in && options.keepAssignee(principal),
    ),
  );
  let ws = putEntity(made.workspace, 'tasks', { ...made.task, assignees: carried });
  const copyId = made.task.id;
  // A subtask starts with its parent's tags: the copy has exactly the original's.
  const wanted = new Set(members(original.tags));
  for (const tag of members(made.task.tags)) {
    if (!wanted.has(tag)) ws = setTaskTag(ctx, ws, copyId, tag, false);
  }
  if (original.constantReminder) ws = updateTask(ctx, ws, copyId, { constantReminder: true });
  for (const file of attachmentsOf(source, original.id)) {
    ws = addAttachment(ctx, ws, {
      taskId: copyId,
      name: file.name,
      size: file.size,
      mime: file.mime,
      sha256: file.sha256,
    }).workspace;
  }
  // Subtasks in their order, each after the one copied before it.
  for (const child of siblings(source, original.listId, original.id)) {
    ws = copyTree(ctx, ws, source, child, {
      ...options,
      parentId: copyId,
      afterId: null,
    }).workspace;
  }
  return { workspace: ws, task: requireEntity(ws, 'tasks', copyId) };
}

/**
 * The tasks that `duplicateTasks` copies for these ids: the live ones, without any whose parent
 * (or a higher one) is among them, since it comes along with that one. Its length is how many
 * copies there will be, for the Undo label.
 */
export function toDuplicate(workspace: WorkspaceFile, ids: readonly Id[]): Task[] {
  const chosen = new Set(ids);
  return ids
    .map((id) => workspace.entities.tasks.find((task) => task.id === id))
    .filter(
      (task): task is Task =>
        task !== undefined &&
        isLive(task) &&
        !ancestors(workspace, task.id).some((above) => chosen.has(above.id)),
    );
}

/**
 * Copies of these tasks (and their subtasks), each right below its original. A task whose parent
 * is copied too comes along with it, not twice. Returns the copies' ids, in the order given.
 */
export function duplicateTasks(
  ctx: OpContext,
  workspace: WorkspaceFile,
  ids: readonly Id[],
): { workspace: WorkspaceFile; ids: Id[] } {
  const originals = toDuplicate(workspace, ids);
  let ws = workspace;
  const copies: Id[] = [];
  for (const original of originals) {
    const made = copyTree(ctx, ws, workspace, original, {
      listId: original.listId,
      parentId: original.parentId,
      afterId: original.id,
      keepAssignee: () => true,
    });
    ws = made.workspace;
    copies.push(made.task.id);
  }
  return { workspace: ws, ids: copies };
}

/**
 * A new private list like `listId`: its name with `name`, its color and icon, and copies of its
 * open tasks with their subtasks. No members and no assignees but me: it is mine alone.
 */
export function duplicateList(
  ctx: OpContext,
  workspace: WorkspaceFile,
  listId: Id,
  name: string,
): { workspace: WorkspaceFile; list: List } {
  const original = requireEntity(workspace, 'lists', listId);
  const made = createList(ctx, workspace, { name, color: original.color, icon: original.icon });
  let ws = made.workspace;
  const me = `user:${ctx.userId}`;
  for (const task of siblings(workspace, listId, null)) {
    if (task.status !== 'open') continue;
    ws = copyTree(ctx, ws, workspace, task, {
      listId: made.list.id,
      parentId: null,
      afterId: null,
      keepAssignee: (principal) => principal === me,
    }).workspace;
  }
  return { workspace: ws, list: made.list };
}
