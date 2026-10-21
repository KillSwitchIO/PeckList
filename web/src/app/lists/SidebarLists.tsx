import AddRounded from '@mui/icons-material/AddRounded';
import CreateNewFolderRounded from '@mui/icons-material/CreateNewFolderRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import { useState } from 'react';
import { useLocation } from 'react-router';
import {
  createFolder,
  createList,
  deleteFolder,
  renameFolder,
  visibleFolders,
  visibleLists,
} from '../../core/lists.ts';
import { openCounts } from '../../core/queries.ts';
import type { Folder, List as ListEntity } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { ListDialog, NameDialog } from './ListDialog.tsx';

function ListLink({
  list,
  count,
  indent,
  onNavigate,
}: {
  list: ListEntity;
  count: number;
  indent: boolean;
  onNavigate: (path: string) => void;
}) {
  const { pathname } = useLocation();
  const path = `/lists/${list.id}`;
  return (
    <ListItemButton
      selected={pathname === path}
      onClick={() => onNavigate(path)}
      sx={{ pl: indent ? 4 : 2 }}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: list.color }} />
      </ListItemIcon>
      <ListItemText primary={list.name} />
      {count > 0 && (
        <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>
          {count}
        </Box>
      )}
    </ListItemButton>
  );
}

function FolderHeader({ folder }: { folder: Folder }) {
  const apply = useApply();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <ListItemButton disableRipple sx={{ cursor: 'default', pr: 0.5 }}>
        <ListItemIcon sx={{ minWidth: 28 }}>
          <FolderRounded fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={folder.name} slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
        <IconButton
          size="small"
          aria-label={`${t('common.more')}: ${folder.name}`}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <MoreVertRounded fontSize="small" />
        </IconButton>
      </ListItemButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setRenaming(true);
          }}
        >
          <EditRounded fontSize="small" sx={{ mr: 1 }} />
          {t('common.rename')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            apply((ctx, ws) => deleteFolder(ctx, ws, folder.id), t('undo.folderDeleted'));
          }}
        >
          <DeleteOutlineRounded fontSize="small" sx={{ mr: 1 }} />
          {t('folder.delete')}
        </MenuItem>
      </Menu>
      {renaming && (
        <NameDialog
          open
          title={t('common.rename')}
          label={t('folder.name')}
          initial={folder.name}
          submitLabel={t('common.save')}
          onClose={() => setRenaming(false)}
          onSubmit={(name) => {
            apply((ctx, ws) => renameFolder(ctx, ws, folder.id, name));
            setRenaming(false);
          }}
        />
      )}
    </>
  );
}

/** Folders and lists in the sidebar, with create buttons. The Inbox lives under smart views. */
export function SidebarLists({ onNavigate }: { onNavigate: (path: string) => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const [creatingList, setCreatingList] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const lists = visibleLists(workspace).filter((list) => !list.isInbox);
  const folders = visibleFolders(workspace);
  const counts = openCounts(workspace);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const loose = lists.filter((list) => !list.folderId || !folderIds.has(list.folderId));

  return (
    <>
      <List
        dense
        subheader={
          <ListSubheader
            sx={{ bgcolor: 'transparent', display: 'flex', alignItems: 'center', pr: 1 }}
          >
            <Box sx={{ flexGrow: 1 }}>{t('nav.lists')}</Box>
            <Tooltip title={t('list.newFolder')}>
              <IconButton
                size="small"
                aria-label={t('list.newFolder')}
                onClick={() => setCreatingFolder(true)}
              >
                <CreateNewFolderRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('list.new')}>
              <IconButton
                size="small"
                aria-label={t('list.new')}
                onClick={() => setCreatingList(true)}
              >
                <AddRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </ListSubheader>
        }
      >
        {folders.map((folder) => (
          <Box key={folder.id}>
            <FolderHeader folder={folder} />
            {lists
              .filter((list) => list.folderId === folder.id)
              .map((list) => (
                <ListLink
                  key={list.id}
                  list={list}
                  count={counts.get(list.id) ?? 0}
                  indent
                  onNavigate={onNavigate}
                />
              ))}
          </Box>
        ))}
        {loose.map((list) => (
          <ListLink
            key={list.id}
            list={list}
            count={counts.get(list.id) ?? 0}
            indent={false}
            onNavigate={onNavigate}
          />
        ))}
      </List>
      {creatingList && (
        <ListDialog
          open
          onClose={() => setCreatingList(false)}
          onSubmit={(value) => {
            let id = '';
            apply((ctx, ws) => {
              const result = createList(ctx, ws, value);
              id = result.list.id;
              return result.workspace;
            });
            setCreatingList(false);
            onNavigate(`/lists/${id}`);
          }}
        />
      )}
      {creatingFolder && (
        <NameDialog
          open
          title={t('list.newFolder')}
          label={t('folder.name')}
          submitLabel={t('common.create')}
          onClose={() => setCreatingFolder(false)}
          onSubmit={(name) => {
            apply((ctx, ws) => createFolder(ctx, ws, name).workspace);
            setCreatingFolder(false);
          }}
        />
      )}
    </>
  );
}
