import AddRounded from '@mui/icons-material/AddRounded';
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Tooltip,
} from '@mui/material';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { createList, visibleLists } from '../../core/lists.ts';
import { openCounts } from '../../core/queries.ts';
import type { List as ListEntity } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { ListDialog } from './ListDialog.tsx';
import { listName } from './listName.ts';

function ListLink({
  list,
  count,
  onNavigate,
}: {
  list: ListEntity;
  count: number;
  onNavigate: (path: string) => void;
}) {
  const { pathname } = useLocation();
  const path = `/lists/${list.id}`;
  return (
    <ListItemButton selected={pathname === path} onClick={() => onNavigate(path)}>
      <ListItemIcon sx={{ minWidth: 28 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: list.color }} />
      </ListItemIcon>
      <ListItemText primary={listName(list)} />
      {count > 0 && (
        <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>
          {count}
        </Box>
      )}
    </ListItemButton>
  );
}

/** Lists in the sidebar with a create button. The Mess Drawer lives under smart views. */
export function SidebarLists({ onNavigate }: { onNavigate: (path: string) => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const [creating, setCreating] = useState(false);
  const lists = visibleLists(workspace).filter((list) => !list.isInbox);
  const counts = openCounts(workspace);

  return (
    <>
      <List
        dense
        subheader={
          <ListSubheader
            sx={{ bgcolor: 'transparent', display: 'flex', alignItems: 'center', pr: 1 }}
          >
            <Box sx={{ flexGrow: 1 }}>{t('nav.lists')}</Box>
            <Tooltip title={t('list.new')} disableFocusListener>
              <IconButton size="small" aria-label={t('list.new')} onClick={() => setCreating(true)}>
                <AddRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </ListSubheader>
        }
      >
        {lists.map((list) => (
          <ListLink
            key={list.id}
            list={list}
            count={counts.get(list.id) ?? 0}
            onNavigate={onNavigate}
          />
        ))}
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
