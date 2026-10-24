import { IconButton, ListItemIcon, Menu, MenuItem, Tooltip } from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { inboxList } from '../../core/lists.ts';
import { deleteSavedFilter, filterOf, updateSavedFilter } from '../../core/savedFilters.ts';
import { t } from '../i18n/i18n.ts';
import { DeleteIcon, EditIcon, MoreIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
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
  const [menu, setMenu] = useState<HTMLElement | null>(null);
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

  const actions = (
    <>
      <SortGroupButton view={view} groupings={VIEW_GROUPINGS} />
      <Tooltip title={t('common.more')}>
        <IconButton aria-label={t('common.more')} onClick={(event) => setMenu(event.currentTarget)}>
          <MoreIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setMenu(null);
            setEditing(true);
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          {t('filter.edit')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenu(null);
            apply((ctx, ws) => deleteSavedFilter(ctx, ws, saved.id), t('undo.filterDeleted'));
            void navigate('/all');
          }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          {t('filter.delete')}
        </MenuItem>
      </Menu>
    </>
  );

  return (
    <Page title={saved.name} actions={actions}>
      <AddTaskInput defaults={{ listId: inboxList(workspace).id }} />
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
