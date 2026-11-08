// Editing the sidebar as one: the views (order, hidden, the More group, pinned lists and tags),
// the lists' order and the tags' order. Any section can start editing (a drag, a hold or a
// right-click); Done saves everything in one undoable step, Cancel drops it.

import { useEffect, useState, type ReactNode } from 'react';
import { popupOpen } from '../hooks/keys.ts';
import { reorderLists, visibleLists } from '../../core/lists.ts';
import {
  defaultSidebar,
  normalizeSidebar,
  pinnedListId,
  pinnedTagId,
  setSidebar,
  sidebarOf,
} from '../../core/sidebar.ts';
import { reorderTags, tagTree, updateTag } from '../../core/tags.ts';
import { bottomBarOf, defaultBottomBar, fitBottomBar, setBottomBar } from '../../core/bottomBar.ts';
import type { SidebarLayout } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { useViewIds } from './bottomTabs.tsx';
import { SidebarEditContext, type SidebarDraft, type SidebarEdit } from './sidebarEditContext.ts';

const same = (a: readonly string[], b: readonly string[]) => a.join() === b.join();

export function SidebarEditProvider({
  children,
  editsBar = false,
}: {
  children: ReactNode;
  /** Rows get a button to go on or off the phone's bottom bar (the More page). */
  editsBar?: boolean;
}) {
  const workspace = useWorkspace();
  const apply = useApply();
  const views = useViewIds();
  const lists = visibleLists(workspace)
    .filter((list) => !list.isInbox)
    .map((list) => list.id);
  const tags = tagTree(workspace).map((node) => node.tag.id);
  const pinnable = [...lists.map(pinnedListId), ...tags.map(pinnedTagId)];
  const saved: SidebarDraft = {
    layout: sidebarOf(workspace, views, pinnable),
    lists,
    tags,
    tagNames: {},
    bottomBar: bottomBarOf(workspace, views),
  };
  const [draft, setDraft] = useState<SidebarDraft | null>(null);
  const [creatingFilter, setCreatingFilter] = useState(false);
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
        bottomBar: fitBottomBar(defaultBottomBar(), views),
      })),
    done: () => {
      if (draft) {
        apply((ctx, ws) => {
          let next = setSidebar(ctx, ws, draft.layout);
          // Moved tags: parents first (renaming a tag renames its subtags too).
          const depth = (id: string) =>
            ws.entities.tags.find((tag) => tag.id === id)?.name.split('/').length ?? 0;
          for (const [id, name] of Object.entries(draft.tagNames).sort(
            ([a], [b]) => depth(a) - depth(b),
          )) {
            const tag = next.entities.tags.find((each) => each.id === id);
            if (tag && tag.name !== name) next = updateTag(ctx, next, id, { name });
          }
          if (!same(draft.lists, saved.lists)) next = reorderLists(ctx, next, draft.lists);
          if (!same(draft.tags, saved.tags)) next = reorderTags(ctx, next, draft.tags);
          if (!same(draft.bottomBar, saved.bottomBar)) {
            next = setBottomBar(ctx, next, draft.bottomBar);
          }
          return next;
        }, t('undo.sidebar'));
      }
      setDraft(null);
    },
    saveLayout: (layout: SidebarLayout) => apply((ctx, ws) => setSidebar(ctx, ws, layout)),
    editsBar,
    creatingFilter,
    setCreatingFilter,
  };
  return <SidebarEditContext.Provider value={value}>{children}</SidebarEditContext.Provider>;
}
