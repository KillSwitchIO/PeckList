// Editing the sidebar as one: the views (order, hidden, the More group, pinned lists and tags),
// the lists' order and the tags' order. Any section can start editing (a drag, a hold or a
// right-click); Done saves everything in one undoable step, Cancel drops it.

import { useEffect, useState, type ReactNode } from 'react';
import { popupOpen } from '../hooks/keys.ts';
import { reorderLists, visibleLists } from '../../core/lists.ts';
import { savedFiltersOf } from '../../core/savedFilters.ts';
import {
  BUILT_IN_VIEWS,
  defaultSidebar,
  filterViewId,
  normalizeSidebar,
  pinnedListId,
  pinnedTagId,
  setSidebar,
  sidebarOf,
} from '../../core/sidebar.ts';
import { reorderTags, tagTree } from '../../core/tags.ts';
import type { SidebarLayout } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { SidebarEditContext, type SidebarDraft, type SidebarEdit } from './sidebarEditContext.ts';

const same = (a: readonly string[], b: readonly string[]) => a.join() === b.join();

export function SidebarEditProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const views = [
    ...BUILT_IN_VIEWS,
    ...savedFiltersOf(workspace).map((filter) => filterViewId(filter.id)),
  ];
  const lists = visibleLists(workspace)
    .filter((list) => !list.isInbox)
    .map((list) => list.id);
  const tags = tagTree(workspace).map((node) => node.tag.id);
  const pinnable = [...lists.map(pinnedListId), ...tags.map(pinnedTagId)];
  const saved: SidebarDraft = { layout: sidebarOf(workspace, views, pinnable), lists, tags };
  const [draft, setDraft] = useState<SidebarDraft | null>(null);
  const editing = draft !== null;
  // Escape leaves editing without saving (unless a dialog is open, which closes first).
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !popupOpen()) setDraft(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const value: SidebarEdit = {
    editing,
    current: draft ?? saved,
    views,
    start: () => setDraft((before) => before ?? saved),
    update: (change) => setDraft((before) => change(before ?? saved)),
    cancel: () => setDraft(null),
    reset: () =>
      setDraft((before) => ({
        ...(before ?? saved),
        layout: normalizeSidebar(defaultSidebar(), views, pinnable),
      })),
    done: () => {
      if (draft) {
        apply((ctx, ws) => {
          let next = setSidebar(ctx, ws, draft.layout);
          if (!same(draft.lists, saved.lists)) next = reorderLists(ctx, next, draft.lists);
          if (!same(draft.tags, saved.tags)) next = reorderTags(ctx, next, draft.tags);
          return next;
        }, t('undo.sidebar'));
      }
      setDraft(null);
    },
    saveLayout: (layout: SidebarLayout) => apply((ctx, ws) => setSidebar(ctx, ws, layout)),
  };
  return <SidebarEditContext.Provider value={value}>{children}</SidebarEditContext.Provider>;
}
