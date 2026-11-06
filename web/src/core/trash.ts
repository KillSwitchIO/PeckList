// Purging the trash (spec: PL-019, PL-130): deleted things stay restorable for the time the person
// picked (purgeDaysOf), then their content is erased. The tombstone itself stays (id, clocks, a
// deletedAt) so every device still learns of the delete; its deletedAt moves to the epoch, which
// keeps it out of the trash for good. Won't-do tasks go to the trash after the same time.

import { putEntities } from './collections.ts';
import { parseHlc } from './hlc.ts';
import { members, setElement, softDelete, updateEntity, isoNow, type OpContext } from './ops.ts';
import { purgeDaysOf } from './settings.ts';
import { myRole } from './sharing.ts';
import type { ElementSet, Id, Task, WorkspaceFile } from './types.ts';

/** The deletedAt of a purged entity: before anything was ever deleted. */
export const PURGED_AT = '1970-01-01T00:00:00.000Z';

/**
 * What an erased comment, attachment or tag holds: the schema wants at least one character there.
 * Must match <c>SharingIndex.Erased</c> on the server.
 */
export const ERASED = '-';

export const isPurged = (entity: { deletedAt: string | null }) => entity.deletedAt === PURGED_AT;

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
 * Erase everything deleted longer ago than the person's time, and move won't-do tasks that old to
 * the trash. Returns the same workspace when there is nothing to do, so running it on every start
 * costs nothing.
 */
export function purgeExpired(ctx: OpContext, workspace: WorkspaceFile, now: number): WorkspaceFile {
  const cutoff = new Date(now - purgeDaysOf(workspace) * 86_400_000).toISOString();
  return trashOldWontDo(ctx, purgeOlderThan(ctx, workspace, cutoff), cutoff);
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
 * Won't-do tasks past the time go to the trash, still restorable, with their subtasks. A task with
 * an open subtask stays: that work is not over.
 *
 * The time counts from when it was marked won't do or last came back from the trash, by the
 * clocks of those fields. completedAt would not do: an imported task's is years old, and a restored
 * task would go straight back.
 */
function trashOldWontDo(ctx: OpContext, workspace: WorkspaceFile, cutoff: string): WorkspaceFile {
  const closed = workspace.entities.tasks.filter(
    (task) => task.deletedAt === null && task.status === 'wontdo',
  );
  if (closed.length === 0) return workspace;
  const { mine } = eraseRules(ctx, workspace);
  const before = Date.parse(cutoff);
  const old = (clock: string | undefined) => clock === undefined || parseHlc(clock).wall < before;
  const children = new Map<Id, Task[]>();
  for (const task of workspace.entities.tasks) {
    if (task.deletedAt === null && task.parentId !== null) {
      children.set(task.parentId, [...(children.get(task.parentId) ?? []), task]);
    }
  }
  const below = (id: Id): Task[] =>
    (children.get(id) ?? []).flatMap((child) => [child, ...below(child.id)]);
  const due = new Set(
    closed
      .filter(
        (task) =>
          old(task._hlc.status) &&
          old(task._hlc.deletedAt) &&
          mine(task.listId) &&
          !below(task.id).some((each) => each.status === 'open'),
      )
      .map((task) => task.id),
  );
  if (due.size === 0) return workspace;
  // One moment for each subtree, which is how a restore finds what went together.
  const at = isoNow(ctx);
  const moved = closed
    .filter((task) => due.has(task.id) && !(task.parentId !== null && due.has(task.parentId)))
    .flatMap((task) => [task, ...below(task.id)])
    .map((task) => softDelete(ctx, task, at));
  return putEntities(workspace, 'tasks', moved);
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
    (task) => (due(task) || isPurged(task)) && mine(task.listId),
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
