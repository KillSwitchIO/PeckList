// What the phone's bottom bar shows (spec: PL-094): the person's tabs (schema 9) and More.
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import type { ReactElement } from 'react';
import { bottomBarOf, SEARCH_TAB } from '../../core/bottomBar.ts';
import { savedFiltersOf } from '../../core/savedFilters.ts';
import { BUILT_IN_VIEWS, filterViewId, SHARED_VIEWS } from '../../core/sidebar.ts';
import { t } from '../i18n/i18n.ts';
import { FilterIcon } from '../icons/icons.tsx';
import { useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { SIDEBAR_FOOTER, VIEW_ITEMS } from './navigation.tsx';

export interface Tab {
  id: string;
  path: string;
  label: string;
  icon: ReactElement;
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
  const filters = new Map(
    savedFiltersOf(workspace).map((filter) => [filterViewId(filter.id), filter]),
  );
  const search = SIDEBAR_FOOTER.find((item) => item.path === '/search')!;
  return ids.flatMap((id): Tab[] => {
    if (id === SEARCH_TAB) {
      return [{ id, path: search.path, label: t(search.label), icon: search.icon }];
    }
    const view = VIEW_ITEMS[id];
    if (view) return [{ id, path: view.path, label: t(view.label), icon: view.icon }];
    const filter = filters.get(id);
    if (filter) {
      return [{ id, path: `/filters/${filter.id}`, label: filter.name, icon: <FilterIcon /> }];
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
