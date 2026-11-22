import { useNavigate, useParams } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { filterOf, setSavedFilterView, viewOf } from '../../core/savedFilters.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { AddToInbox } from '../tasks/AddTaskInput.tsx';
import { FilteredTasks } from '../views/groups.tsx';
import { SortGroupButton } from '../views/SortGroupButton.tsx';
import { useListView } from '../lists/listGrouping.ts';
import { VIEW_GROUPINGS } from '../../core/listView.ts';
import { EmptyState } from '../views/EmptyState.tsx';
import { useFilterActions } from './useFilterActions.tsx';

/** A saved filter's tasks, grouped and sorted as stored with the filter (by date until picked). */
export function FilterView() {
  const { filterId = '' } = useParams();
  const workspace = useWorkspace();
  const apply = useApply();
  const navigate = useNavigate();
  const saved = getEntity(workspace, 'savedFilters', filterId);
  const live = saved && isLive(saved) ? saved : null;
  const filterActions = useFilterActions(live, () => void navigate('/all'));
  // Its grouping and sort are stored with the filter, so they sync (PL-015).
  const view = useListView(
    `filter:${filterId}`,
    live
      ? {
          choice: viewOf(live),
          save: (next) => apply((ctx, ws) => setSavedFilterView(ctx, ws, live.id, next)),
        }
      : undefined,
  );
  if (!saved || !isLive(saved)) {
    return (
      <Page title={t('nav.filters')}>
        <EmptyState title={t('filter.notFound')} />
      </Page>
    );
  }

  // The filter's own actions join the one view menu.
  const actions = (
    <SortGroupButton view={view} groupings={VIEW_GROUPINGS} extra={filterActions.items} />
  );

  return (
    <Page title={saved.name} actions={actions}>
      <AddToInbox />
      <FilteredTasks filter={filterOf(saved)} view={view} showList emptyTitle={t('filter.empty')} />
      {filterActions.dialogs}
    </Page>
  );
}
