import { isLive } from '../../core/collections.ts';
import { subtasksOf } from '../../core/queries.ts';
import { deleteTask } from '../../core/tasks.ts';
import { purgeTask } from '../../core/trash.ts';
import type { Task, WorkspaceFile } from '../../core/types.ts';
import type { OpContext } from '../../core/ops.ts';

// Tasks the quick add bar's expand button made blank, to be filled in the task form. Closed still
// empty, they go again, so the button never leaves "Untitled" tasks behind.
const drafts = new Set<string>();

export function markDraft(id: string): void {
  drafts.add(id);
}

/** A draft nothing was typed into yet: lists leave it out while its form is open. */
export function isBlankDraft(task: Task): boolean {
  return drafts.has(task.id) && task.title.trim() === '';
}

/** When `id` is a draft: forget it, and delete the task if nothing was filled in. */
export function settleDraft(ctx: OpContext, workspace: WorkspaceFile, id: string): WorkspaceFile {
  if (!drafts.delete(id)) return workspace;
  const task = workspace.entities.tasks.find((each) => each.id === id);
  if (!task || !isLive(task) || task.title.trim() !== '' || task.notes.trim() !== '')
    return workspace;
  if (subtasksOf(workspace, id).length > 0) return workspace;
  // Straight out, not into the trash: there was never anything in it.
  return purgeTask(ctx, deleteTask(ctx, workspace, id), id);
}
