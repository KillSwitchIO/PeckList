import AddRounded from '@mui/icons-material/AddRounded';
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from '@mui/material';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { getEntity } from '../../core/collections.ts';
import { createList } from '../../core/lists.ts';
import { openCounts } from '../../core/queries.ts';
import { moveInOrder, pinnedListId, togglePinned } from '../../core/sidebar.ts';
import type { List as ListEntity } from '../../core/types.ts';
import { useCollapsedSet } from '../hooks/useCollapsedSet.ts';
import { t } from '../i18n/i18n.ts';
import { DragHandleIcon } from '../icons/icons.tsx';
import { editingRowSx, useSidebarEdit } from '../layout/sidebarEditContext.ts';
import { PinButton } from '../layout/PinButton.tsx';
import { SectionHeader } from '../layout/SectionHeader.tsx';
import { useSortableRows } from '../layout/useSortableRows.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { ListDialog } from './ListDialog.tsx';
import { listName } from './listName.ts';

/** Lists in the sidebar with a create button. The Mess Drawer lives under smart views. */
export function SidebarLists({ onNavigate }: { onNavigate: (path: string) => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const { pathname } = useLocation();
  const edit = useSidebarEdit();
  const { editing } = edit;
  const [creating, setCreating] = useState(false);
  // Folded sections are remembered on this device.
  const { collapsed: folded, toggle: fold } = useCollapsedSet('punchlist.foldedSections');
  const counts = openCounts(workspace);
  const lists = edit.current.lists
    .map((id) => getEntity(workspace, 'lists', id))
    .filter((list): list is ListEntity => list !== undefined);
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
            return (
              <ListItemButton
                key={list.id}
                {...sortable.rowProps(list.id)}
                selected={!editing && pathname === path}
                onClick={sortable.click(() => {
                  if (!editing) onNavigate(path);
                })}
                sx={editingRowSx(editing, sortable.dragging === list.id, index)}
              >
                {editing && (
                  <DragHandleIcon
                    fontSize="small"
                    sx={{ color: 'text.disabled', ml: -1, mr: 0.5, cursor: 'grab' }}
                  />
                )}
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: list.color }} />
                </ListItemIcon>
                <ListItemText primary={listName(list)} slotProps={{ primary: { noWrap: true } }} />
                {editing ? (
                  <PinButton
                    pinned={edit.current.layout.order.includes(pin)}
                    name={listName(list)}
                    onToggle={() =>
                      edit.update((draft) => ({
                        ...draft,
                        layout: togglePinned(draft.layout, pin),
                      }))
                    }
                  />
                ) : (
                  count > 0 && (
                    <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>
                      {count}
                    </Box>
                  )
                )}
              </ListItemButton>
            );
          })}
      </List>
      {creating && (
        <ListDialog
          open
          onClose={() => setCreating(false)}
          onSubmit={(value) => {
            let id = '';
            apply((ctx, ws) => {
              const result = createList(ctx, ws, value);
              id = result.list.id;
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
