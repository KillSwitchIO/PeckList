import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import { MenuItem } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { deleteList, updateList } from '../../core/lists.ts';
import type { List } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { ConfirmDialog, ListDialog } from './ListDialog.tsx';
import { listName } from './listName.ts';

/**
 * A list's Edit and Delete from its row's menu in the sidebar and on More (PL-149), as its own
 * page's menu has them: for the owner, never the Mess Drawer. Delete asks first, and its undo line
 * brings the list back. `onDeleted` runs once it is gone (to leave its page, say).
 */
export function useListActions(
  list: List | null,
  onDeleted?: () => void,
): { items: (close: () => void) => ReactNode[]; dialogs: ReactNode } {
  const apply = useApply();
  const workspace = useWorkspace();
  const [open, setOpen] = useState<'edit' | 'delete' | null>(null);
  const items = (close: () => void) => [
    <MenuItem
      key="edit"
      onClick={() => {
        close();
        setOpen('edit');
      }}
    >
      <EditRounded fontSize="small" sx={{ mr: 1 }} />
      {t('list.edit')}
    </MenuItem>,
    <MenuItem
      key="delete"
      onClick={() => {
        close();
        setOpen('delete');
      }}
    >
      <DeleteOutlineRounded fontSize="small" sx={{ mr: 1 }} />
      {t('list.delete')}
    </MenuItem>,
  ];
  const dialogs = list && (
    <>
      {open === 'edit' && (
        <ListDialog
          open
          list={list}
          onClose={() => setOpen(null)}
          onSubmit={(value) => {
            apply((ctx, ws) => updateList(ctx, ws, list.id, value));
            setOpen(null);
          }}
        />
      )}
      <ConfirmDialog
        open={open === 'delete'}
        message={t('list.deleteConfirm', { name: listName(list, workspace) })}
        confirmLabel={t('common.delete')}
        onClose={() => setOpen(null)}
        onConfirm={() => {
          setOpen(null);
          apply((ctx, ws) => deleteList(ctx, ws, list.id), t('undo.listDeleted'));
          onDeleted?.();
        }}
      />
    </>
  );
  return { items, dialogs };
}
