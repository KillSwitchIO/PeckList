// The phone's bottom bar (schema 9): up to four tabs before More, picked and ordered by the
// person. Tabs are sidebar view ids (built-in views, saved filters) or `search`.

import { putEntity } from './collections.ts';
import { updateEntity, type OpContext } from './ops.ts';
import type { WorkspaceFile } from './types.ts';

export const SEARCH_TAB = 'search';
export const MAX_TABS = 4;

export function defaultBottomBar(): string[] {
  return ['today', 'inbox', 'calendar', SEARCH_TAB];
}

/** The tabs to show: the saved ones (or the default) that still exist, at most four. */
export function bottomBarOf(workspace: WorkspaceFile, views: readonly string[]): string[] {
  return fitBottomBar(workspace.entities.settings[0]?.bottomBar ?? defaultBottomBar(), views);
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

export function setBottomBar(
  ctx: OpContext,
  workspace: WorkspaceFile,
  tabs: readonly string[],
): WorkspaceFile {
  const settings = workspace.entities.settings[0];
  if (!settings) return workspace;
  return putEntity(workspace, 'settings', updateEntity(ctx, settings, { bottomBar: [...tabs] }));
}
