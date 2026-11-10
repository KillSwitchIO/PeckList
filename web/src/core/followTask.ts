// Comments and files follow their task into the Trash and back (audit B5). Deleting a task left
// them live, so the server kept their files for good and a purge never erased them. Now a live
// one goes with its task, at the task's own deletedAt; a restore brings back only those that went
// with it (an author's own earlier delete stays). Only deletedAt changes and gets a new stamp:
// the server takes another person's comment or file this way and no other.

import { putEntities } from './collections.ts';
import { restore, softDelete, type OpContext } from './ops.ts';
import { ERASED } from './erased.ts';
import type { DateTime, Id, WorkspaceFile } from './types.ts';

/** Into the Trash at `at` with these tasks: each live comment and file on them. */
export function followIntoTrash(
  ctx: OpContext,
  workspace: WorkspaceFile,
  taskIds: ReadonlySet<Id>,
  at: DateTime,
): WorkspaceFile {
  if (taskIds.size === 0) return workspace;
  const going = (entity: { taskId: Id; deletedAt: string | null }) =>
    entity.deletedAt === null && taskIds.has(entity.taskId);
  let next = workspace;
  const comments = workspace.entities.comments.filter(going);
  if (comments.length > 0) {
    next = putEntities(
      next,
      'comments',
      comments.map((comment) => softDelete(ctx, comment, at)),
    );
  }
  const files = workspace.entities.attachments.filter(going);
  if (files.length > 0) {
    next = putEntities(
      next,
      'attachments',
      files.map((file) => softDelete(ctx, file, at)),
    );
  }
  return next;
}

/**
 * Back with these tasks, each restored from the Trash where it was at `wentAt`: the comments and
 * files that went with it (same deletedAt), not erased.
 */
export function followOutOfTrash(
  ctx: OpContext,
  workspace: WorkspaceFile,
  tasks: readonly { id: Id; wentAt: DateTime }[],
): WorkspaceFile {
  if (tasks.length === 0) return workspace;
  const wentAt = new Map(tasks.map((task) => [task.id, task.wentAt]));
  const back = (entity: { taskId: Id; deletedAt: string | null }) =>
    entity.deletedAt !== null && wentAt.get(entity.taskId) === entity.deletedAt;
  let next = workspace;
  const comments = workspace.entities.comments.filter(
    (comment) => back(comment) && comment.body !== ERASED,
  );
  if (comments.length > 0) {
    next = putEntities(
      next,
      'comments',
      comments.map((comment) => restore(ctx, comment)),
    );
  }
  const files = workspace.entities.attachments.filter((file) => back(file) && file.name !== ERASED);
  if (files.length > 0) {
    next = putEntities(
      next,
      'attachments',
      files.map((file) => restore(ctx, file)),
    );
  }
  return next;
}
