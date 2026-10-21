// Tags. Names are paths: `home/yard` is nested under `home`.

import { isLive, putEntities, putEntity, requireEntity } from './collections.ts';
import { createEntity, setElement, softDelete, updateEntity, type OpContext } from './ops.ts';
import type { Id, Tag, WorkspaceFile } from './types.ts';

export function normalizeTagName(name: string): string {
  return name
    .split('/')
    .map((part) => part.trim().replace(/\s+/g, '-'))
    .filter(Boolean)
    .join('/');
}

export function visibleTags(workspace: WorkspaceFile): Tag[] {
  return workspace.entities.tags.filter(isLive).sort((a, b) => a.name.localeCompare(b.name));
}

export function findTagByName(workspace: WorkspaceFile, name: string): Tag | undefined {
  const wanted = normalizeTagName(name).toLowerCase();
  return visibleTags(workspace).find((tag) => tag.name.toLowerCase() === wanted);
}

export function createTag(
  ctx: OpContext,
  workspace: WorkspaceFile,
  name: string,
  color: string,
): { workspace: WorkspaceFile; tag: Tag } {
  const normalized = normalizeTagName(name);
  if (!normalized) throw new Error('tag name is empty');
  const existing = findTagByName(workspace, normalized);
  if (existing) return { workspace, tag: existing };
  const tag = createEntity<Tag>(ctx, { name: normalized, color });
  return { workspace: putEntity(workspace, 'tags', tag), tag };
}

export function updateTag(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  patch: { name?: string; color?: string },
): WorkspaceFile {
  const tag = requireEntity(workspace, 'tags', id);
  const next = patch.name === undefined ? patch : { ...patch, name: normalizeTagName(patch.name) };
  return putEntity(workspace, 'tags', updateEntity(ctx, tag, next));
}

/** Delete a tag and remove it from every task. */
export function deleteTag(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const tag = requireEntity(workspace, 'tags', id);
  const tasks = workspace.entities.tasks
    .filter((task) => task.tags[id]?.in)
    .map((task) => ({ ...task, tags: setElement(ctx, task.tags, id, false) }));
  return putEntities(putEntity(workspace, 'tags', softDelete(ctx, tag)), 'tasks', tasks);
}

/** Tag paths with their parents, for a nested tree: `home/yard` -> ['home', 'home/yard']. */
export function tagAncestry(name: string): string[] {
  const parts = name.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}
