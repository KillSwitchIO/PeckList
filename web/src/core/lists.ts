// Lists and sections. (Folders were dropped on 2026-10-20: organization is lists + tags.)

import { isLive, putEntities, putEntity, requireEntity } from './collections.ts';
import { compareOrderKeys, keyBetween } from './ordering.ts';
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

// --- sections -------------------------------------------------------------------------

export function sectionsOf(workspace: WorkspaceFile, listId: Id): Section[] {
  return byOrder(
    workspace.entities.sections.filter((section) => section.listId === listId && isLive(section)),
  );
}

export function createSection(
  ctx: OpContext,
  workspace: WorkspaceFile,
  listId: Id,
  name: string,
): { workspace: WorkspaceFile; section: Section } {
  requireEntity(workspace, 'lists', listId);
  const section = createEntity<Section>(ctx, {
    listId,
    name: name.trim(),
    order: endKey(sectionsOf(workspace, listId)),
  });
  return { workspace: putEntity(workspace, 'sections', section), section };
}

export function renameSection(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  name: string,
): WorkspaceFile {
  const section = requireEntity(workspace, 'sections', id);
  return putEntity(workspace, 'sections', updateEntity(ctx, section, { name: name.trim() }));
}

/**
 * Move a section to just before `beforeId` (null: after the last one). Only its own order key
 * changes, so the move syncs as one small change.
 */
export function moveSection(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  beforeId: Id | null,
): WorkspaceFile {
  const section = requireEntity(workspace, 'sections', id);
  const others = sectionsOf(workspace, section.listId).filter((each) => each.id !== id);
  const index =
    beforeId === null ? others.length : others.findIndex((each) => each.id === beforeId);
  if (index < 0) throw new Error(`section ${beforeId} not found`);
  const before = index > 0 ? others[index - 1]!.order : null;
  const after = index < others.length ? others[index]!.order : null;
  if (before === null && after === null) return workspace;
  return putEntity(
    workspace,
    'sections',
    updateEntity(ctx, section, { order: keyBetween(before, after) }),
  );
}

/** Delete a section; its tasks stay in the list without a section. */
export function deleteSection(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const section = requireEntity(workspace, 'sections', id);
  const tasks = workspace.entities.tasks.filter((task) => task.sectionId === id && isLive(task));
  const next = putEntity(workspace, 'sections', softDelete(ctx, section));
  return putEntities(
    next,
    'tasks',
    tasks.map((task) => updateEntity(ctx, task, { sectionId: null })),
  );
}
