// Purging the trash (spec: PL-019, PL-130): deleted things stay restorable for the time the person
// picked (purgeDaysOf), then their content is erased. The tombstone itself stays (id, clocks, a
// deletedAt) so every device still learns of the delete; its deletedAt moves to the epoch, which
// keeps it out of the trash for good. Completed and won't-do tasks go to the trash after the same time.

import { putEntities } from './collections.ts';
import { ERASED } from './erased.ts';
import { followIntoTrash } from './followTask.ts';
import { parseHlc } from './hlc.ts';
import { members, setElement, softDelete, updateEntity, isoNow, type OpContext } from './ops.ts';
import { purgeDaysOf } from './settings.ts';
import { myRole } from './sharing.ts';
import type { ElementSet, Id, Task, WorkspaceFile } from './types.ts';

/** The deletedAt of a purged entity: before anything was ever deleted. */
export const PURGED_AT = '1970-01-01T00:00:00.000Z';

export { ERASED } from './erased.ts';

export const isPurged = (entity: { deletedAt: string | null }) => entity.deletedAt === PURGED_AT;

/**
 * A task erased on one device while another, not yet told, moved it to the trash. Fields merge one
 * by one, so the erasing keeps its empty text and the later delete keeps its date: an "Untitled
 * task" in the trash with nothing in it. It is erased already, and a pass puts its date right.
 */
export function isBlankTombstone(task: Task): boolean {
  return (
    task.deletedAt !== null &&
    !isPurged(task) &&
    task.title === '' &&
    task.notes === '' &&
    task.status === 'open' &&
    task.completedAt === null &&
    task.schedule === null
  );
}

/**
 * A task with nothing of its content left: what it said, its dates, reminders, tags and people.
 * What stays places the tombstone (its list and parent, which sharing reads) and orders it.
 */
function purgedTask(ctx: OpContext, task: Task): Task {
  const emptied = (set: ElementSet) =>
    members(set).reduce((next, element) => setElement(ctx, next, element, false), set);
  return updateEntity(ctx, task, {
    title: '',
    notes: '',
    deletedAt: PURGED_AT,
    status: 'open',
    completedAt: null,
    completedBy: null,
    priority: 0,
    schedule: null,
    due: null,
    recurrence: null,
    progress: 0,
    tags: emptied(task.tags),
    assignees: emptied(task.assignees),
    blockedBy: emptied(task.blockedBy),
    ...(task.pinnedAt ? { pinnedAt: null } : {}),
    ...(task.reminders?.length ? { reminders: [] } : {}),
    ...(task.constantReminder ? { constantReminder: false } : {}),
  });
}

/**
 * Who may erase what hangs on a task, as the server rules: its author, and the owner of its list.
 * Answers per list are kept, since a pass can ask thousands of times.
 */
function eraseRules(ctx: OpContext, workspace: WorkspaceFile) {
  const owned = new Map<Id, boolean>();
  const mine = (listId: Id) => {
    let answer = owned.get(listId);
    if (answer === undefined) {
      answer = myRole(workspace, ctx.userId, listId) === 'owner';
      owned.set(listId, answer);
    }
    return answer;
  };
  const tasks = new Map(workspace.entities.tasks.map((task) => [task.id, task]));
  const onTask = (entity: { createdBy: Id; taskId: Id }) => {
    const task = tasks.get(entity.taskId);
    return entity.createdBy === ctx.userId || (task !== undefined && mine(task.listId));
  };
  return { mine, onTask };
}

/**
 * Erase comments and files: those on `gone` tasks, and those `due` on their own. An erased file's
 * bytes go at the server's next clean-up, unless something else still names them.
 */
function eraseOnTasks(
  ctx: OpContext,
  workspace: WorkspaceFile,
  gone: ReadonlySet<Id>,
  due: (entity: { deletedAt: string | null }) => boolean,
): WorkspaceFile {
  const { onTask } = eraseRules(ctx, workspace);
  const wanted = (entity: { deletedAt: string | null; createdBy: Id; taskId: Id }) =>
    (gone.has(entity.taskId) || due(entity)) && onTask(entity);
  const changed = <T>(before: readonly T[], after: readonly T[]) =>
    after.filter((each, at) => each !== before[at]);

  const comments = workspace.entities.comments.filter(wanted);
  const attachments = workspace.entities.attachments.filter(wanted);
  let next = workspace;
  const erasedComments = changed(
    comments,
    comments.map((comment) => updateEntity(ctx, comment, { body: ERASED, deletedAt: PURGED_AT })),
  );
  if (erasedComments.length > 0) next = putEntities(next, 'comments', erasedComments);
  const erasedFiles = changed(
    attachments,
    attachments.map((file) => updateEntity(ctx, file, { name: ERASED, deletedAt: PURGED_AT })),
  );
  if (erasedFiles.length > 0) next = putEntities(next, 'attachments', erasedFiles);
  return next;
}

const never = () => false;

/** Whether this trashed task is mine to erase: only the list's owner erases its trash (audit C2). */
export function mayErase(workspace: WorkspaceFile, me: Id, task: Task): boolean {
  return myRole(workspace, me, task.listId) === 'owner';
}

/** Delete a task in the trash for good, with the subtasks that were deleted along with it. */
export function purgeTask(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const task = workspace.entities.tasks.find((each) => each.id === id);
  if (!task || task.deletedAt === null || isPurged(task)) return workspace;
  if (!mayErase(workspace, ctx.userId, task)) return workspace;
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
  const next = putEntities(
    workspace,
    'tasks',
    workspace.entities.tasks
      .filter((each) => together.has(each.id))
      .map((each) => purgedTask(ctx, each)),
  );
  return eraseOnTasks(ctx, next, together, never);
}

/** Empty the trash: purge every task, list and section in it that is mine, now. */
export function emptyTrash(ctx: OpContext, workspace: WorkspaceFile): WorkspaceFile {
  return purgeOlderThan(ctx, workspace, '9999-12-31T23:59:59.999Z');
}

/**
 * Erase everything deleted longer ago than the person's time, and move completed and won't-do
 * tasks that old to the trash. Returns the same workspace when there is nothing to do, so running it on every start
 * costs nothing.
 */
export function purgeExpired(ctx: OpContext, workspace: WorkspaceFile, now: number): WorkspaceFile {
  const cutoff = new Date(now - purgeDaysOf(workspace) * 86_400_000).toISOString();
  return trashOldClosed(ctx, purgeOlderThan(ctx, workspace, cutoff), cutoff);
}

/** How many of my tasks in the trash a shorter time would erase at once, for the Settings page to ask. */
export function erasedByShortening(workspace: WorkspaceFile, days: number, now: number): number {
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  return workspace.entities.tasks.filter(
    (task) =>
      task.deletedAt !== null &&
      !isPurged(task) &&
      task.deletedAt < cutoff &&
      myRole(workspace, workspace.owner, task.listId) === 'owner',
  ).length;
}

/**
 * Completed and won't-do tasks past the time go to the trash, still restorable, with their
 * subtasks. A task stays while any subtask has time left or is open: that work is not over. So does
 * a completed subtask of a task that stays, which is part of its parent's record.
 *
 * A closed task counts from the date it was closed, imported history included (Ben, 2026-11-06),
 * or from when its status was set if it has no date. A task restored from the trash gets the full
 * time again, or it would go straight back.
 */
function trashOldClosed(ctx: OpContext, workspace: WorkspaceFile, cutoff: string): WorkspaceFile {
  const live = workspace.entities.tasks.filter((task) => task.deletedAt === null);
  const closed = live.filter((task) => task.status === 'done' || task.status === 'wontdo');
  if (closed.length === 0) return workspace;
  const { mine } = eraseRules(ctx, workspace);
  const before = Date.parse(cutoff);
  const wall = (clock: string | undefined) => (clock === undefined ? 0 : parseHlc(clock).wall);
  // A delete's clock differs from the task's first one only once it has been deleted and restored.
  const restoredAt = (task: Task) =>
    task._hlc.deletedAt === task._hlc.createdAt ? 0 : wall(task._hlc.deletedAt);
  const closedAt = (task: Task) =>
    task.completedAt ? Date.parse(task.completedAt) : wall(task._hlc.status);
  const past = (task: Task) =>
    task.status !== 'open' && Math.max(closedAt(task), restoredAt(task)) < before;

  const parents = new Map(live.map((task) => [task.id, task]));
  const children = new Map<Id, Task[]>();
  for (const task of live) {
    if (task.parentId === null) continue;
    const peers = children.get(task.parentId);
    if (peers) peers.push(task);
    else children.set(task.parentId, [task]);
  }
  const below = (id: Id): Task[] =>
    (children.get(id) ?? []).flatMap((child) => [child, ...below(child.id)]);
  const due = new Set(
    closed
      .filter((task) => past(task) && mine(task.listId) && below(task.id).every(past))
      .map((task) => task.id),
  );
  const startsAMove = (task: Task) => {
    if (!due.has(task.id)) return false;
    const parent = task.parentId === null ? undefined : parents.get(task.parentId);
    if (parent === undefined) return true;
    return !due.has(parent.id) && task.status !== 'done';
  };
  const moving = closed.filter(startsAMove);
  if (moving.length === 0) return workspace;
  // One moment for each subtree, which is how a restore finds what went together.
  const at = isoNow(ctx);
  const going = moving.flatMap((task) => [task, ...below(task.id)]);
  return followIntoTrash(
    ctx,
    putEntities(
      workspace,
      'tasks',
      going.map((task) => softDelete(ctx, task, at)),
    ),
    new Set(going.map((task) => task.id)),
    at,
  );
}

/**
 * Only trash in lists I own is mine to erase (audit C2). A viewer's purges of a shared list's
 * trash are refused by the server at every start ("The server refused N changes"), and an editor
 * would blank the owner's trash: the owner's own device erases it.
 *
 * Tasks purged by older versions are finished here too: those kept dates, tags and comments.
 */
function purgeOlderThan(ctx: OpContext, workspace: WorkspaceFile, cutoff: string): WorkspaceFile {
  const { mine } = eraseRules(ctx, workspace);
  const due = (entity: { deletedAt: string | null }) =>
    entity.deletedAt !== null && !isPurged(entity) && entity.deletedAt < cutoff;
  const myOwn = (entity: { deletedAt: string | null; createdBy: Id }) =>
    due(entity) && entity.createdBy === ctx.userId;
  let next = workspace;
  const purged = workspace.entities.tasks.filter(
    (task) => (due(task) || isPurged(task) || isBlankTombstone(task)) && mine(task.listId),
  );
  const tasks = purged
    .map((task) => purgedTask(ctx, task))
    .filter((task, at) => task !== purged[at]);
  if (tasks.length > 0) next = putEntities(next, 'tasks', tasks);
  next = eraseOnTasks(ctx, next, new Set(purged.map((task) => task.id)), due);

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
  // Tags, folders and saved filters are personal, so only their maker has them to erase.
  const tags = workspace.entities.tags.filter(myOwn);
  if (tags.length > 0) {
    next = putEntities(
      next,
      'tags',
      tags.map((tag) => updateEntity(ctx, tag, { name: ERASED, deletedAt: PURGED_AT })),
    );
  }
  const folders = workspace.entities.folders.filter(myOwn);
  if (folders.length > 0) {
    next = putEntities(
      next,
      'folders',
      folders.map((folder) => updateEntity(ctx, folder, { name: '', deletedAt: PURGED_AT })),
    );
  }
  const filters = workspace.entities.savedFilters.filter(myOwn);
  if (filters.length > 0) {
    next = putEntities(
      next,
      'savedFilters',
      filters.map((filter) =>
        updateEntity(ctx, filter, { name: '', query: {}, deletedAt: PURGED_AT }),
      ),
    );
  }
  return next;
}
