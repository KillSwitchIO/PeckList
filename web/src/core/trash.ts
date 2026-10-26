// Purging the trash (spec: PL-019): deleted things stay restorable for TRASH_DAYS, then their
// content is erased. The tombstone itself stays (id, clocks, a deletedAt) so every device still
// learns of the delete; its deletedAt moves to the epoch, which keeps it out of the trash for good.

import { putEntities } from './collections.ts';
import { updateEntity, type OpContext } from './ops.ts';
import { TRASH_DAYS } from './queries.ts';
import { myRole } from './sharing.ts';
import type { Id, Task, WorkspaceFile } from './types.ts';

/** The deletedAt of a purged entity: before anything was ever deleted. */
export const PURGED_AT = '1970-01-01T00:00:00.000Z';

export const isPurged = (entity: { deletedAt: string | null }) => entity.deletedAt === PURGED_AT;

function purgedTask(ctx: OpContext, task: Task): Task {
  return updateEntity(ctx, task, { title: '', notes: '', deletedAt: PURGED_AT });
}

/** Delete a task in the trash for good, with the subtasks that were deleted along with it. */
export function purgeTask(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const task = workspace.entities.tasks.find((each) => each.id === id);
  if (!task || task.deletedAt === null || isPurged(task)) return workspace;
  const together = new Set([id]);
  // Walk down: children deleted at the same moment went to the trash with it.
  let grew = true;
  while (grew) {
    grew = false;
    for (const each of workspace.entities.tasks) {
      if (
        !together.has(each.id) &&
        each.parentId !== null &&
        together.has(each.parentId) &&
        each.deletedAt === task.deletedAt
      ) {
        together.add(each.id);
        grew = true;
      }
    }
  }
  return putEntities(
    workspace,
    'tasks',
    workspace.entities.tasks
      .filter((each) => together.has(each.id))
      .map((each) => purgedTask(ctx, each)),
  );
}

/** Empty the trash: purge every task, list and section in it that is mine, now. */
export function emptyTrash(ctx: OpContext, workspace: WorkspaceFile): WorkspaceFile {
  return purgeOlderThan(ctx, workspace, '9999-12-31T23:59:59.999Z');
}

/**
 * Erase everything deleted more than TRASH_DAYS ago. Returns the same workspace when there is
 * nothing to do, so running it on every start costs nothing.
 */
export function purgeExpired(ctx: OpContext, workspace: WorkspaceFile, now: number): WorkspaceFile {
  return purgeOlderThan(ctx, workspace, new Date(now - TRASH_DAYS * 86_400_000).toISOString());
}

/**
 * Only trash in lists I own is mine to erase (audit C2). A viewer's purges of a shared list's
 * trash are refused by the server at every start ("The server refused N changes"), and an editor
 * would blank the owner's trash: the owner's own device erases it.
 */
function purgeOlderThan(ctx: OpContext, workspace: WorkspaceFile, cutoff: string): WorkspaceFile {
  const mine = (listId: Id) => myRole(workspace, ctx.userId, listId) === 'owner';
  const due = (entity: { deletedAt: string | null }) =>
    entity.deletedAt !== null && !isPurged(entity) && entity.deletedAt < cutoff;
  let next = workspace;
  const tasks = workspace.entities.tasks.filter((task) => due(task) && mine(task.listId));
  if (tasks.length > 0) {
    next = putEntities(
      next,
      'tasks',
      tasks.map((task) => purgedTask(ctx, task)),
    );
  }
  const lists = workspace.entities.lists.filter((list) => due(list) && mine(list.id));
  if (lists.length > 0) {
    next = putEntities(
      next,
      'lists',
      lists.map((list) => updateEntity(ctx, list, { name: '', deletedAt: PURGED_AT })),
    );
  }
  const sections = workspace.entities.sections.filter(
    (section) => due(section) && mine(section.listId),
  );
  if (sections.length > 0) {
    next = putEntities(
      next,
      'sections',
      sections.map((section) => updateEntity(ctx, section, { name: '', deletedAt: PURGED_AT })),
    );
  }
  return next;
}
