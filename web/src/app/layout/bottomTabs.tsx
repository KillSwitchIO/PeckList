// What the phone's bottom bar shows (spec: PL-094): the person's tabs (schema 9) and More.
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import TagRounded from '@mui/icons-material/TagRounded';
import { Box, useTheme } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';
import { bottomBarOf } from '../../core/bottomBar.ts';
import { getEntity, isLive } from '../../core/collections.ts';
import { savedFiltersOf } from '../../core/savedFilters.ts';
import { BUILT_IN_VIEWS, filterViewId, SHARED_VIEWS } from '../../core/sidebar.ts';
import { t } from '../i18n/i18n.ts';
import { FilterIcon } from '../icons/icons.tsx';
import { ListMark } from '../lists/ListMark.tsx';
import { listName } from '../lists/listName.ts';
import { useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { tagIconColor } from '../tags/tagColors.ts';
import { VIEW_ITEMS } from './navigation.tsx';
import { PathText } from './SidebarViews.tsx';

export interface Tab {
  id: string;
  path: string;
  /** Short enough for a tab: a list's own name, the last part of a tag's. */
  label: string;
  icon: ReactElement;
  /** The name in full, where there is room for it (the editor), when `label` shortens it. */
  fullLabel?: string;
  fullName?: ReactNode;
}

/** The same space for every mark, so a small one leaves its label level with the others. */
function TabMark({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        width: 22,
        height: 22,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Box>
  );
}

/** The views that exist: built-in ones (shared ones with a server account) and saved filters. */
export function useViewIds(): string[] {
  const workspace = useWorkspace();
  const phase = useSyncState((state) => state.phase);
  const authMode = useSyncState((state) => state.account?.authMode);
  return [
    ...BUILT_IN_VIEWS,
    ...(phase === 'ready' && authMode === 'local' ? SHARED_VIEWS : []),
    ...savedFiltersOf(workspace).map((filter) => filterViewId(filter.id)),
  ];
}

/** Describe tab ids for the bar and its editor (unknown ids drop out). */
export function useTabs(ids: readonly string[]): Tab[] {
  const workspace = useWorkspace();
  const theme = useTheme();
  const filters = new Map(
    savedFiltersOf(workspace).map((filter) => [filterViewId(filter.id), filter]),
  );
  return ids.flatMap((id): Tab[] => {
    const view = VIEW_ITEMS[id];
    if (view) return [{ id, path: view.path, label: t(view.label), icon: view.icon }];
    const filter = filters.get(id);
    if (filter) {
      return [{ id, path: `/filters/${filter.id}`, label: filter.name, icon: <FilterIcon /> }];
    }
    const [kind, entityId = ''] = id.split(':');
    if (kind === 'list') {
      const list = getEntity(workspace, 'lists', entityId);
      if (!list || !isLive(list)) return [];
      const fullLabel = listName(list, workspace);
      return [
        {
          id,
          path: `/lists/${list.id}`,
          label: list.name,
          fullLabel,
          fullName: fullLabel,
          icon: (
            <TabMark>
              <ListMark list={list} />
            </TabMark>
          ),
        },
      ];
    }
    if (kind === 'tag') {
      const tag = getEntity(workspace, 'tags', entityId);
      if (!tag || !isLive(tag)) return [];
      return [
        {
          id,
          path: `/tags/${tag.id}`,
          label: tag.name.split('/').at(-1) ?? tag.name,
          fullLabel: tag.name,
          fullName: <PathText path={tag.name} />,
          icon: (
            <TabMark>
              <TagRounded
                sx={{ color: tagIconColor(tag.color, theme.palette.background.default) }}
              />
            </TabMark>
          ),
        },
      ];
    }
    return [];
  });
}

/** The saved bottom bar, then More. */
export function useBottomTabs(): Tab[] {
  const workspace = useWorkspace();
  const views = useViewIds();
  return [
    ...useTabs(bottomBarOf(workspace, views)),
    { id: 'more', path: '/more', label: t('nav.more'), icon: <MoreHorizRounded /> },
  ];
}
