// The sidebar's layout, saved in the user's settings: the order of the views, which are hidden,
// and a collapsible group. `order` holds every view once plus the GROUP marker; views after the
// marker sit inside the group.

import { putEntity } from './collections.ts';
import { updateEntity, type OpContext } from './ops.ts';
import type { SidebarLayout, WorkspaceFile } from './types.ts';

export const GROUP = '@group';

/** The built-in views, in their default order. */
export const BUILT_IN_VIEWS = [
  'today',
  'inbox',
  'upcoming',
  'due',
  'all',
  'calendar',
  'completed',
  'trash',
] as const;

/** Views that need a server with accounts; the sidebar offers them only then. */
export const SHARED_VIEWS = ['assigned', 'shared'] as const;

export function defaultSidebar(): SidebarLayout {
  return {
    order: ['today', 'inbox', 'upcoming', 'due', 'all', 'calendar', GROUP, 'completed', 'trash'],
    hidden: [],
    groupOpen: false,
  };
}

/** A saved filter's id in the layout. */
export const filterViewId = (filterId: string) => `filter:${filterId}`;

/** A list or tag pinned among the views. */
export const pinnedListId = (listId: string) => `list:${listId}`;
export const pinnedTagId = (tagId: string) => `tag:${tagId}`;

/**
 * The layout made to fit the views that exist: unknown ids go, missing views join the end of the
 * ungrouped ones (just above the group), and there is exactly one group marker. `pinnable` ids
 * (lists and tags) stay where they are when present but are never added.
 */
export function normalizeSidebar(
  layout: SidebarLayout,
  views: readonly string[],
  pinnable: readonly string[] = [],
): SidebarLayout {
  const known = new Set([...views, ...pinnable]);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of layout.order) {
    if (id === GROUP ? seen.has(GROUP) : !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  if (!seen.has(GROUP)) order.push(GROUP);
  const missing = views.filter((id) => !seen.has(id));
  order.splice(order.indexOf(GROUP), 0, ...missing);
  return {
    order,
    hidden: layout.hidden.filter((id) => known.has(id)),
    groupOpen: layout.groupOpen,
  };
}

/** Move `id` so it ends up at `index` (an index into the order without it). */
export function moveInOrder(order: readonly string[], id: string, index: number): string[] {
  const rest = order.filter((each) => each !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Show or hide a view. */
export function toggleHidden(layout: SidebarLayout, id: string): SidebarLayout {
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((each) => each !== id)
    : [...layout.hidden, id];
  return { ...layout, hidden };
}

/** Pin (just above the group) or unpin a list or tag. */
export function togglePinned(layout: SidebarLayout, id: string): SidebarLayout {
  if (layout.order.includes(id)) {
    return {
      ...layout,
      order: layout.order.filter((each) => each !== id),
      hidden: layout.hidden.filter((each) => each !== id),
    };
  }
  const order = [...layout.order];
  order.splice(order.indexOf(GROUP), 0, id);
  return { ...layout, order };
}

/** The saved layout (or the default), fitted to `views` and the `pinnable` lists and tags. */
export function sidebarOf(
  workspace: WorkspaceFile,
  views: readonly string[],
  pinnable: readonly string[] = [],
): SidebarLayout {
  const saved = workspace.entities.settings[0]?.sidebar ?? defaultSidebar();
  return normalizeSidebar(saved, views, pinnable);
}

export function setSidebar(
  ctx: OpContext,
  workspace: WorkspaceFile,
  layout: SidebarLayout,
): WorkspaceFile {
  const settings = workspace.entities.settings[0];
  if (!settings) return workspace;
  return putEntity(workspace, 'settings', updateEntity(ctx, settings, { sidebar: layout }));
}
