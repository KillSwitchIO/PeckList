import AddRounded from '@mui/icons-material/AddRounded';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  Tooltip,
} from '@mui/material';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getEntity } from '../../core/collections.ts';
import { visibleLists } from '../../core/lists.ts';
import { openCounts } from '../../core/queries.ts';
import { myRole } from '../../core/sharing.ts';
import { moveInOrder, pinnedListId, togglePinned } from '../../core/sidebar.ts';
import type { List as ListEntity } from '../../core/types.ts';
import { useCollapsedSet } from '../hooks/useCollapsedSet.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { editingRowSx, useSidebarEdit } from '../layout/sidebarEditContext.ts';
import { BarButton } from '../layout/BarButton.tsx';
import { PinButton } from '../layout/PinButton.tsx';
import { SectionHeader } from '../layout/SectionHeader.tsx';
import { useSortableRows } from '../layout/useSortableRows.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { RowCountAndMenu } from '../layout/RowMenu.tsx';
import { rightClickMenu, rowMenuHoverSx, type RowMenuAt } from '../layout/rowMenuHelpers.ts';
import { useListActions } from './useListActions.tsx';
import { ListDialog } from './ListDialog.tsx';
import { makeList } from './newList.ts';
import { listName } from './listName.ts';
import { ListMark } from './ListMark.tsx';
import { SortHandle } from '../layout/SortHandle.tsx';

/** Lists in the sidebar with a create button. The Mess Drawer lives under smart views. */
export function SidebarLists({ onNavigate }: { onNavigate: (path: string) => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const { pathname } = useLocation();
  const edit = useSidebarEdit();
  const { editing } = edit;
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const me = useStoreState((state) => state.context().userId);
  // A list's row menu (PL-149): Edit and Delete for its owner, never the Mess Drawer, as on its page.
  const [menu, setMenu] = useState<{ id: string; at: RowMenuAt } | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const actionList = actionId ? (getEntity(workspace, 'lists', actionId) ?? null) : null;
  const listActions = useListActions(actionList, () => {
    if (pathname === `/lists/${actionId}`) void navigate('/inbox');
  });
  const openMenu = (id: string, at: RowMenuAt) => {
    setActionId(id);
    setMenu({ id, at });
  };
  // Folded sections are remembered on this device.
  const { collapsed: folded, toggle: fold } = useCollapsedSet('pecklist.foldedSections');
  const counts = openCounts(workspace);
  const lists = edit.current.lists
    .map((id) => getEntity(workspace, 'lists', id))
    .filter((list): list is ListEntity => list !== undefined);
  // Archived lists wait in a group at the end, closed until opened (remembered on this device).
  const archived = visibleLists(workspace, true).filter((list) => list.archived);
  const showArchived = folded.has('archived-open');
  const sortable = useSortableRows({
    editing,
    start: edit.start,
    onDrag: (id, y) =>
      edit.update((draft) => {
        const index = sortable.slot(
          draft.lists.filter((each) => each !== id),
          y,
        );
        const next = moveInOrder(draft.lists, id, index);
        return next.join() === draft.lists.join() ? draft : { ...draft, lists: next };
      }),
  });

  return (
    <>
      <List
        dense
        aria-label={t('nav.lists')}
        subheader={
          <SectionHeader
            title={t('nav.lists')}
            open={!folded.has('lists')}
            onToggle={() => fold('lists')}
            actions={
              <Tooltip title={t('list.new')} disableFocusListener>
                <IconButton
                  size="small"
                  aria-label={t('list.new')}
                  onClick={() => setCreating(true)}
                >
                  <AddRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            }
          />
        }
      >
        {!folded.has('lists') &&
          lists.map((list, index) => {
            const path = `/lists/${list.id}`;
            const count = counts.get(list.id) ?? 0;
            const pin = pinnedListId(list.id);
            const props = sortable.rowProps(list.id);
            const menuable = myRole(workspace, me, list.id) === 'owner' && !list.isInbox;
            return (
              <ListItemButton
                key={list.id}
                {...props}
                {...(menuable
                  ? {
                      onContextMenu: rightClickMenu(
                        editing,
                        (at) => openMenu(list.id, at),
                        props.onContextMenu,
                      ),
                    }
                  : {})}
                selected={!editing && pathname === path}
                onClick={sortable.click(() => {
                  if (!editing) onNavigate(path);
                })}
                // A task dragged out of a list can be dropped here to move it.
                data-drop-list={list.id}
                sx={{
                  ...editingRowSx(editing, sortable.dragging === list.id, index),
                  ...(!editing && menuable ? rowMenuHoverSx : {}),
                  '&.drop-hover': {
                    bgcolor: 'action.selected',
                    boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
                  },
                }}
              >
                {editing && <SortHandle />}
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <ListMark list={list} />
                </ListItemIcon>
                <ListItemText
                  primary={listName(list, workspace)}
                  slotProps={{ primary: { noWrap: true } }}
                />
                <BarButton id={pin} name={listName(list, workspace)} />
                {editing && (
                  <PinButton
                    pinned={edit.current.layout.order.includes(pin)}
                    name={listName(list, workspace)}
                    onToggle={() =>
                      edit.update((draft) => ({
                        ...draft,
                        layout: togglePinned(draft.layout, pin),
                      }))
                    }
                  />
                )}
                {menuable ? (
                  <RowCountAndMenu
                    count={editing ? 0 : count}
                    editing={editing}
                    label={t('list.actionsNamed', { name: listName(list, workspace) })}
                    expanded={menu?.id === list.id}
                    onOpen={(at) => openMenu(list.id, at)}
                  />
                ) : (
                  !editing &&
                  count > 0 && (
                    <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>
                      {count}
                    </Box>
                  )
                )}
              </ListItemButton>
            );
          })}
        {!folded.has('lists') && !editing && archived.length > 0 && (
          <>
            <ListItemButton
              aria-expanded={showArchived}
              onClick={() => fold('archived-open')}
              sx={{ color: 'text.secondary' }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
                <ArchiveOutlined sx={{ fontSize: 16 }} />
              </ListItemIcon>
              <ListItemText primary={t('list.archived')} />
              <Box component="span" sx={{ typography: 'caption' }}>
                {archived.length}
              </Box>
            </ListItemButton>
            {showArchived &&
              archived.map((list) => {
                const path = `/lists/${list.id}`;
                return (
                  <ListItemButton
                    key={list.id}
                    selected={pathname === path}
                    onClick={() => onNavigate(path)}
                    sx={{ pl: 4, color: 'text.secondary' }}
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <ListMark list={list} faded />
                    </ListItemIcon>
                    <ListItemText
                      primary={listName(list, workspace)}
                      slotProps={{ primary: { noWrap: true } }}
                    />
                  </ListItemButton>
                );
              })}
          </>
        )}
      </List>
      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        {...(menu ? { anchorPosition: menu.at } : {})}
      >
        {listActions.items(() => setMenu(null))}
      </Menu>
      {listActions.dialogs}
      {creating && (
        <ListDialog
          open
          onClose={() => setCreating(false)}
          onSubmit={(value) => {
            let id = '';
            apply((ctx, ws) => {
              const result = makeList(ctx, ws, value, today);
              id = result.listId;
              return result.workspace;
            });
            setCreating(false);
            onNavigate(`/lists/${id}`);
          }}
        />
      )}
    </>
  );
}
