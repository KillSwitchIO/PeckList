import { ListItemIcon, MenuItem } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { deleteSavedFilter, filterOf, lookOf, updateSavedFilter } from '../../core/savedFilters.ts';
import type { SavedFilter } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { DeleteIcon, EditIcon } from '../icons/icons.tsx';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { useApply } from '../store/hooks.ts';
import { FilterDialog } from './FilterDialog.tsx';

/**
 * A saved filter's Edit and Delete, wherever its menu is: its own view's, or its row's in the
 * sidebar and on More (PL-149: without opening it first). Delete asks first, and its undo line
 * brings it back. `onDeleted` runs once it is gone (to leave its page, say).
 */
export function useFilterActions(
  saved: SavedFilter | null,
  onDeleted?: () => void,
): { items: (close: () => void) => ReactNode[]; dialogs: ReactNode } {
  const apply = useApply();
  const [open, setOpen] = useState<'edit' | 'delete' | null>(null);
  const items = (close: () => void) => [
    <MenuItem
      key="edit"
      onClick={() => {
        close();
        setOpen('edit');
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
        setOpen('delete');
      }}
    >
      <ListItemIcon>
        <DeleteIcon fontSize="small" />
      </ListItemIcon>
      {t('filter.delete')}
    </MenuItem>,
  ];
  const dialogs = saved && (
    <>
      {open === 'edit' && (
        <FilterDialog
          initial={{ name: saved.name, filter: filterOf(saved), look: lookOf(saved) }}
          onClose={() => setOpen(null)}
          onSave={(name, filter, look) => {
            apply((ctx, ws) => updateSavedFilter(ctx, ws, saved.id, name, filter, look));
            setOpen(null);
          }}
        />
      )}
      <ConfirmDialog
        open={open === 'delete'}
        message={t('filter.deleteConfirm', { name: saved.name })}
        confirmLabel={t('common.delete')}
        onClose={() => setOpen(null)}
        onConfirm={() => {
          setOpen(null);
          apply((ctx, ws) => deleteSavedFilter(ctx, ws, saved.id), t('undo.filterDeleted'));
          onDeleted?.();
        }}
      />
    </>
  );
  return { items, dialogs };
}
