// Tags. Names are lowercase paths: `home/yard` is nested under `home`.

import { isLive, putEntities, putEntity, requireEntity } from './collections.ts';
import {
  createEntity,
  isoNow,
  members,
  setElement,
  softDelete,
  updateEntity,
  type OpContext,
} from './ops.ts';
import { COLOR_FAMILIES, findFamilyColor } from './palette.ts';
import type { Id, Tag, Task, WorkspaceFile } from './types.ts';

export function normalizeTagName(name: string): string {
  return name
    .split('/')
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
    .join('/');
}

/** Last path segment: `home/yard` -> `yard`. */
export function leafName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

/** Everything before the last segment: `home/yard` -> `home`; '' at the top level. */
export function parentTagPath(name: string): string {
  const cut = name.lastIndexOf('/');
  return cut < 0 ? '' : name.slice(0, cut);
}

/** Whether `name` is `ancestor` or nested anywhere under it (case-insensitive). */
export function isUnder(name: string, ancestor: string): boolean {
  const a = name.toLowerCase();
  const b = ancestor.toLowerCase();
  return a === b || a.startsWith(`${b}/`);
}

export function visibleTags(workspace: WorkspaceFile): Tag[] {
  return workspace.entities.tags.filter(isLive).sort((a, b) => a.name.localeCompare(b.name));
}

export function findTagByName(workspace: WorkspaceFile, name: string): Tag | undefined {
  const wanted = normalizeTagName(name).toLowerCase();
  return visibleTags(workspace).find((tag) => tag.name.toLowerCase() === wanted);
}

/** Tag paths with their parents, for a nested tree: `home/yard` -> ['home', 'home/yard']. */
export function tagAncestry(name: string): string[] {
  const parts = name.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/**
 * Default color for a new tag named `name`, never one another tag already has (while any are left):
 * - nested under a tag with a family color: the next colors of that family after the parent's,
 *   skipping colors in use (parent R, first child O, second child Y);
 * - top level, or a parent with a custom color: the first unused color, family by family.
 * `reserve` holds colors about to be used by the same operation.
 */
export function suggestTagColor(
  workspace: WorkspaceFile,
  name: string,
  reserve: readonly string[] = [],
): string {
  const tags = visibleTags(workspace);
  const used = new Set([...tags.map((tag) => tag.color), ...reserve].map((c) => c.toUpperCase()));
  const parentPath = parentTagPath(normalizeTagName(name));
  const parent = parentPath ? findTagByName(workspace, parentPath) : undefined;
  const spot = parent ? findFamilyColor(parent.color) : null;
  if (parent && spot) {
    const colors = spot.family.colors;
    const after = colors.map((_, k) => colors[(spot.index + 1 + k) % colors.length]!.hex);
    const nearby = new Set(
      [parent, ...tags.filter((tag) => parentTagPath(tag.name) === parent.name)].map((tag) =>
        tag.color.toUpperCase(),
      ),
    );
    return (
      after.find((hex) => !used.has(hex)) ?? after.find((hex) => !nearby.has(hex)) ?? after[0]!
    );
  }
  const all = COLOR_FAMILIES.flatMap((item) => item.colors.map((color) => color.hex));
  return all.find((hex) => !used.has(hex)) ?? all[tags.length % all.length]!;
}

/** Create the missing parents of `name` (all but the last segment), each with a suggested color. */
function ensureParents(
  ctx: OpContext,
  workspace: WorkspaceFile,
  name: string,
  reserve: readonly string[],
): WorkspaceFile {
  let next = workspace;
  for (const path of tagAncestry(name).slice(0, -1)) {
    if (!findTagByName(next, path)) {
      const color = suggestTagColor(next, path, reserve);
      next = putEntity(next, 'tags', createEntity<Tag>(ctx, { name: path, color }));
    }
  }
  return next;
}

/**
 * Create a tag (and any missing parents). Returns the existing tag when the name is taken.
 * Without a color, the tag gets the suggested one (see suggestTagColor).
 */
export function createTag(
  ctx: OpContext,
  workspace: WorkspaceFile,
  name: string,
  color?: string,
): { workspace: WorkspaceFile; tag: Tag } {
  const normalized = normalizeTagName(name);
  if (!normalized) throw new Error('tag name is empty');
  const existing = findTagByName(workspace, normalized);
  if (existing) return { workspace, tag: existing };
  const withParents = ensureParents(ctx, workspace, normalized, color ? [color] : []);
  const tag = createEntity<Tag>(ctx, {
    name: normalized,
    color: color ?? suggestTagColor(withParents, normalized),
  });
  return { workspace: putEntity(withParents, 'tags', tag), tag };
}

/** The tag and every tag nested under it. */
export function tagWithDescendants(workspace: WorkspaceFile, id: Id): Tag[] {
  const tag = requireEntity(workspace, 'tags', id);
  return visibleTags(workspace).filter((other) => isUnder(other.name, tag.name));
}

/** Whether another live tag already uses `name`. */
export function tagNameTaken(workspace: WorkspaceFile, name: string, exceptId?: Id): boolean {
  const found = findTagByName(workspace, name);
  return found !== undefined && found.id !== exceptId;
}

/**
 * Rename (or move, by changing the path) and recolor a tag. Nested tags move with it, and
 * missing parents of the new path are created.
 */
export function updateTag(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  patch: { name?: string; color?: string },
): WorkspaceFile {
  const tag = requireEntity(workspace, 'tags', id);
  if (patch.name === undefined || normalizeTagName(patch.name) === tag.name) {
    if (patch.color === undefined) return workspace;
    return putEntity(workspace, 'tags', updateEntity(ctx, tag, { color: patch.color }));
  }
  const name = normalizeTagName(patch.name);
  if (!name) throw new Error('tag name is empty');
  if (isUnder(name, tag.name) && name.toLowerCase() !== tag.name.toLowerCase()) {
    throw new Error('a tag cannot be nested under itself');
  }
  if (tagNameTaken(workspace, name, id)) throw new Error('tag name is taken');
  const renamed = tagWithDescendants(workspace, id).map((other) =>
    updateEntity(ctx, other, {
      name: name + other.name.slice(tag.name.length),
      ...(other.id === id && patch.color !== undefined ? { color: patch.color } : {}),
    }),
  );
  const moved = putEntities(workspace, 'tags', renamed);
  return ensureParents(ctx, moved, name, [patch.color ?? tag.color]);
}

/** Delete a tag and the tags nested under it, removing them from every task. */
export function deleteTag(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const doomed = tagWithDescendants(workspace, id);
  const ids = new Set(doomed.map((tag) => tag.id));
  // One timestamp for the whole delete, so restoring brings back everything deleted together.
  const at = isoNow(ctx);
  const tasks = workspace.entities.tasks
    .filter((task) => members(task.tags).some((tagId) => ids.has(tagId)))
    .map((task) => {
      let tags = task.tags;
      for (const tagId of ids) tags = setElement(ctx, tags, tagId, false);
      return { ...task, tags };
    });
  const deleted = doomed.map((tag) => softDelete(ctx, tag, at));
  return putEntities(putEntities(workspace, 'tags', deleted), 'tasks', tasks);
}

export interface TagNode {
  tag: Tag;
  depth: number;
  /** Nearest live ancestor tag, or null at the top level */
  parentId: Id | null;
  hasChildren: boolean;
}

/**
 * Tags as a tree, flattened in display order (parents before children, siblings by name).
 * A tag whose parent path has no tag (after a merge or import) hangs off the nearest one that does.
 */
export function tagTree(workspace: WorkspaceFile): TagNode[] {
  const tags = visibleTags(workspace);
  const byPath = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag]));
  const parentOf = (tag: Tag): Tag | null => {
    const paths = tagAncestry(tag.name).slice(0, -1).reverse();
    for (const path of paths) {
      const found = byPath.get(path.toLowerCase());
      if (found) return found;
    }
    return null;
  };
  const children = new Map<Id | null, Tag[]>();
  for (const tag of tags) {
    const parent = parentOf(tag);
    const key = parent?.id ?? null;
    children.set(key, [...(children.get(key) ?? []), tag]);
  }
  const out: TagNode[] = [];
  const walk = (parentId: Id | null, depth: number) => {
    const level = (children.get(parentId) ?? []).sort((a, b) =>
      leafName(a.name).localeCompare(leafName(b.name)),
    );
    for (const tag of level) {
      const hasChildren = (children.get(tag.id)?.length ?? 0) > 0;
      out.push({ tag, depth, parentId, hasChildren });
      walk(tag.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** A task's live tags, sorted by name. */
export function tagsOfTask(workspace: WorkspaceFile, task: Task): Tag[] {
  const ids = new Set(members(task.tags));
  return visibleTags(workspace).filter((tag) => ids.has(tag.id));
}
