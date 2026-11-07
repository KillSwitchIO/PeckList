// The phone's bottom bar (schema 9): up to four tabs before More, picked and ordered by the
// person. Tabs are sidebar ids (built-in views, saved filters, lists and tags as they pin) or
// `search`. A tab whose list or tag is gone is only hidden: the id stays saved, so it comes back
// with the list. Older clients don't know these ids and hide them the same way.

import { getEntity, isLive, putEntity } from './collections.ts';
import { updateEntity, type OpContext } from './ops.ts';
import type { WorkspaceFile } from './types.ts';

export const SEARCH_TAB = 'search';
export const MAX_TABS = 4;

export function defaultBottomBar(): string[] {
  return ['today', 'inbox', 'calendar', SEARCH_TAB];
}

/** Whether a tab names a list or tag that can be opened. The Mess Drawer is a view of its own. */
function pinExists(workspace: WorkspaceFile, id: string): boolean {
  const [kind, entityId = ''] = id.split(':');
  if (kind === 'list') {
    const list = getEntity(workspace, 'lists', entityId);
    return !!list && isLive(list) && !list.archived && !list.isInbox;
  }
  if (kind === 'tag') {
    const tag = getEntity(workspace, 'tags', entityId);
    return !!tag && isLive(tag);
  }
  return false;
}

/** The tabs to show: the saved ones (or the default) that still exist, at most four. */
export function bottomBarOf(workspace: WorkspaceFile, views: readonly string[]): string[] {
  const saved = workspace.entities.settings[0]?.bottomBar ?? defaultBottomBar();
  return fitBottomBar(saved, [...views, ...saved.filter((id) => pinExists(workspace, id))]);
}

/** `tabs` without unknown or repeated ids, cut to four. */
export function fitBottomBar(tabs: readonly string[], views: readonly string[]): string[] {
  const known = new Set([...views, SEARCH_TAB]);
  return [...new Set(tabs)].filter((id) => known.has(id)).slice(0, MAX_TABS);
}

/** Add a tab at the end (when there is room) or take it out. */
export function toggleTab(tabs: readonly string[], id: string): string[] {
  if (tabs.includes(id)) return tabs.filter((each) => each !== id);
  return tabs.length < MAX_TABS ? [...tabs, id] : [...tabs];
}

/**
 * Save the tabs. The saved list and tag tabs that are hidden now are kept after them: they were
 * never shown to be taken out, and they come back with their list or tag if there is room.
 */
export function setBottomBar(
  ctx: OpContext,
  workspace: WorkspaceFile,
  tabs: readonly string[],
): WorkspaceFile {
  const settings = workspace.entities.settings[0];
  if (!settings) return workspace;
  const hidden = (settings.bottomBar ?? []).filter(
    (id) =>
      (id.startsWith('list:') || id.startsWith('tag:')) &&
      !tabs.includes(id) &&
      !pinExists(workspace, id),
  );
  return putEntity(
    workspace,
    'settings',
    updateEntity(ctx, settings, { bottomBar: [...tabs, ...hidden] }),
  );
}
