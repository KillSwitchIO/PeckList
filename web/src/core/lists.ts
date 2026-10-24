// Lists. (Folders were dropped on 2026-10-20 and sections on 2026-10-23: organization is lists + tags.)

import { isLive, putEntities, putEntity, requireEntity } from './collections.ts';
import { compareOrderKeys, keyBetween, keysBetween } from './ordering.ts';
import {
  createEntity,
  isoNow,
  restore,
  softDelete,
  updateEntity,
  type OpContext,
  type Patch,
} from './ops.ts';
import type { Id, List, Section, WorkspaceFile } from './types.ts';

function byOrder<T extends { order: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareOrderKeys(a.order, b.order));
}

function endKey(items: { order: string }[]): string {
  const sorted = byOrder(items);
  return keyBetween(sorted.length ? sorted[sorted.length - 1]!.order : null, null);
}

/** Live, non-archived lists in display order; the Inbox comes first. */
export function visibleLists(workspace: WorkspaceFile, includeArchived = false): List[] {
  const lists = workspace.entities.lists.filter(
    (list) => isLive(list) && (includeArchived || !list.archived),
  );
  return byOrder(lists).sort((a, b) => Number(b.isInbox) - Number(a.isInbox));
}

export function inboxList(workspace: WorkspaceFile): List {
  const inbox = workspace.entities.lists.find((list) => list.isInbox && isLive(list));
  if (!inbox) throw new Error('workspace has no Inbox');
  return inbox;
}

export interface ListInput {
  name: string;
  color: string;
  icon?: string | null;
}

export function createList(
  ctx: OpContext,
  workspace: WorkspaceFile,
  input: ListInput,
): { workspace: WorkspaceFile; list: List } {
  const list = createEntity<List>(ctx, {
    name: input.name.trim(),
    color: input.color,
    icon: input.icon ?? null,
    folderId: null, // deprecated field, kept until the next schema change
    visibility: 'private',
    archived: false,
    order: endKey(workspace.entities.lists.filter(isLive)),
    isInbox: false,
  });
  return { workspace: putEntity(workspace, 'lists', list), list };
}

export function updateList(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  patch: Patch<List>,
): WorkspaceFile {
  const list = requireEntity(workspace, 'lists', id);
  if (list.isInbox && (patch.archived || patch.isInbox === false)) {
    throw new Error('the Inbox cannot be archived');
  }
  return putEntity(workspace, 'lists', updateEntity(ctx, list, patch));
}

/** Move a list to the trash together with its sections and tasks. */
export function deleteList(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const list = requireEntity(workspace, 'lists', id);
  if (list.isInbox) throw new Error('the Inbox cannot be deleted');
  const sections = workspace.entities.sections.filter(
    (section) => section.listId === id && isLive(section),
  );
  const tasks = workspace.entities.tasks.filter((task) => task.listId === id && isLive(task));
  const at = isoNow(ctx);
  let next = putEntity(workspace, 'lists', softDelete(ctx, list, at));
  next = putEntities(
    next,
    'sections',
    sections.map((section) => softDelete(ctx, section, at)),
  );
  return putEntities(
    next,
    'tasks',
    tasks.map((task) => softDelete(ctx, task, at)),
  );
}

/** Restore a list and everything that was deleted together with it. */
export function restoreList(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const list = requireEntity(workspace, 'lists', id);
  if (list.deletedAt === null) return workspace;
  const when = list.deletedAt;
  const sections = workspace.entities.sections.filter(
    (s) => s.listId === id && s.deletedAt === when,
  );
  const tasks = workspace.entities.tasks.filter((t) => t.listId === id && t.deletedAt === when);
  let next = putEntity(workspace, 'lists', restore(ctx, list));
  next = putEntities(
    next,
    'sections',
    sections.map((section) => restore(ctx, section)),
  );
  return putEntities(
    next,
    'tasks',
    tasks.map((task) => restore(ctx, task)),
  );
}

/** Reorder a list to sit between two neighbours (either may be null for an open end). */
export function moveList(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  beforeOrder: string | null,
  afterOrder: string | null,
): WorkspaceFile {
  return updateList(ctx, workspace, id, { order: keyBetween(beforeOrder, afterOrder) });
}

/** Put lists in this order; the ones not listed keep theirs. */
export function reorderLists(ctx: OpContext, workspace: WorkspaceFile, ids: Id[]): WorkspaceFile {
  let previous: string | null = null;
  let next = workspace;
  for (const id of ids) {
    const order = keyBetween(previous, null);
    previous = order;
    if (requireEntity(next, 'lists', id).order !== order) {
      next = updateList(ctx, next, id, { order });
    }
  }
  return next;
}

// --- sections (dropped: PL-011) --------------------------------------------------------

/** A list's live sections, in order: only what old data still has, for flattenSections. */
function sectionsOf(workspace: WorkspaceFile, listId: Id): Section[] {
  return byOrder(
    workspace.entities.sections.filter((section) => section.listId === listId && isLive(section)),
  );
}

/**
 * Sections were dropped (Ben, 2026-10-23: they served no purpose). This folds what old data still
 * has into plain lists, once, on lists the person may change (`mayEdit`): the top-level tasks
 * keep the order they showed in (tasks without a section first, then each section's), every task
 * loses its section, and the sections go to the trash. Section names are only headings and go
 * with them. Nothing to do returns the same workspace.
 */
export function flattenSections(
  ctx: OpContext,
  workspace: WorkspaceFile,
  mayEdit: (listId: Id) => boolean,
): WorkspaceFile {
  const lists = new Set<Id>();
  for (const section of workspace.entities.sections) {
    if (isLive(section)) lists.add(section.listId);
  }
  for (const task of workspace.entities.tasks) {
    if (task.sectionId !== null && isLive(task)) lists.add(task.listId);
  }
  let next = workspace;
  for (const listId of lists) {
    if (!mayEdit(listId)) continue;
    const sections = sectionsOf(next, listId);
    const rank = new Map(sections.map((section, index) => [section.id, index + 1]));
    const live = next.entities.tasks.filter((task) => task.listId === listId && isLive(task));
    const top = live
      .filter((task) => task.parentId === null)
      .sort(
        (a, b) =>
          (a.sectionId ? (rank.get(a.sectionId) ?? 0) : 0) -
            (b.sectionId ? (rank.get(b.sectionId) ?? 0) : 0) || compareOrderKeys(a.order, b.order),
      );
    const keys = keysBetween(null, null, top.length);
    const order = new Map(top.map((task, index) => [task.id, keys[index]!]));
    // Re-keyed only when sections had tasks; otherwise the order is already right.
    const reorder = top.some((task) => task.sectionId !== null && rank.has(task.sectionId));
    const changed = live
      .filter((task) => task.sectionId !== null || (reorder && order.has(task.id)))
      .map((task) =>
        updateEntity(ctx, task, {
          sectionId: null,
          ...(reorder && order.has(task.id) ? { order: order.get(task.id)! } : {}),
        }),
      );
    const at = isoNow(ctx);
    next = putEntities(next, 'tasks', changed);
    next = putEntities(
      next,
      'sections',
      sections.map((section) => softDelete(ctx, section, at)),
    );
  }
  return next;
}
