import { ListItemIcon, MenuItem } from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { deleteSavedFilter, filterOf, updateSavedFilter } from '../../core/savedFilters.ts';
import { t } from '../i18n/i18n.ts';
import { DeleteIcon, EditIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { AddToInbox } from '../tasks/AddTaskInput.tsx';
import { FilteredTasks } from '../views/groups.tsx';
import { SortGroupButton } from '../views/SortGroupButton.tsx';
import { useListView } from '../lists/listGrouping.ts';
import { VIEW_GROUPINGS } from '../../core/listView.ts';
import { EmptyState } from '../views/EmptyState.tsx';
import { FilterDialog } from './FilterDialog.tsx';

/** A saved filter's tasks, grouped by date like All. */
export function FilterView() {
  const { filterId = '' } = useParams();
  const workspace = useWorkspace();
  const apply = useApply();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const view = useListView(`filter:${filterId}`);
  const saved = getEntity(workspace, 'savedFilters', filterId);
  if (!saved || !isLive(saved)) {
    return (
      <Page title={t('nav.filters')}>
        <EmptyState title={t('filter.notFound')} />
      </Page>
    );
  }

  // The filter's own actions join the one view menu.
  const actions = (
    <SortGroupButton
      view={view}
      groupings={VIEW_GROUPINGS}
      extra={(close) => [
        <MenuItem
          key="edit"
          onClick={() => {
            close();
            setEditing(true);
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          {t('filter.edit')}
        </MenuItem>,
        <MenuItem
          key="delete"
          onClick={() => {
            close();
            apply((ctx, ws) => deleteSavedFilter(ctx, ws, saved.id), t('undo.filterDeleted'));
            void navigate('/all');
          }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          {t('filter.delete')}
        </MenuItem>,
      ]}
    />
  );

  return (
    <Page title={saved.name} actions={actions}>
      <AddToInbox />
      <FilteredTasks filter={filterOf(saved)} view={view} showList emptyTitle={t('filter.empty')} />
      {editing && (
        <FilterDialog
          initial={{ name: saved.name, filter: filterOf(saved) }}
          onClose={() => setEditing(false)}
          onSave={(name, filter) => {
            apply((ctx, ws) => updateSavedFilter(ctx, ws, saved.id, name, filter));
            setEditing(false);
          }}
        />
      )}
    </Page>
  );
}
