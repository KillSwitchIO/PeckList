import CheckRounded from '@mui/icons-material/CheckRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import { Divider, IconButton, ListSubheader, Menu, MenuItem, Tooltip } from '@mui/material';
import { useState } from 'react';
import { LIST_SORTS, type ListGrouping } from '../../core/listView.ts';
import { t } from '../i18n/i18n.ts';
import { SortGroupIcon } from '../icons/icons.tsx';
import type { ListViewSettings } from '../lists/listGrouping.ts';

/**
 * The sort and group button in a list's or a view's header (spec: Views, sort and group options),
 * with Restore defaults to go back to how the view comes.
 */
export function SortGroupButton({
  view,
  groupings,
}: {
  view: ListViewSettings;
  groupings: readonly ListGrouping[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      <Tooltip title={t('list.sortAndGroup')} disableFocusListener>
        <IconButton
          aria-label={t('list.sortAndGroup')}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ color: view.isDefault ? undefined : 'primary.main' }}
        >
          <SortGroupIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
          {t('list.groupBy')}
        </ListSubheader>
        {groupings.map((mode) => (
          <MenuItem
            key={`group-${mode}`}
            dense
            aria-label={t('list.groupByOption', { name: t(`list.group.${mode}`).toLowerCase() })}
            selected={view.grouping === mode}
            onClick={() => {
              close();
              view.setGrouping(mode);
            }}
          >
            {t(`list.group.${mode}`)}
            {view.grouping === mode && <CheckRounded fontSize="small" sx={{ ml: 'auto', pl: 1 }} />}
          </MenuItem>
        ))}
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
          {t('list.sortBy')}
        </ListSubheader>
        {LIST_SORTS.map((mode) => (
          <MenuItem
            key={`sort-${mode}`}
            dense
            aria-label={t('list.sortByOption', { name: t(`list.sort.${mode}`).toLowerCase() })}
            selected={view.sort === mode}
            onClick={() => {
              close();
              view.setSort(mode);
            }}
          >
            {t(`list.sort.${mode}`)}
            {view.sort === mode && <CheckRounded fontSize="small" sx={{ ml: 'auto', pl: 1 }} />}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          dense
          disabled={view.isDefault}
          onClick={() => {
            close();
            view.reset();
          }}
        >
          <RestartAltRounded fontSize="small" sx={{ mr: 1 }} />
          {t('list.restoreDefaults')}
        </MenuItem>
      </Menu>
    </>
  );
}
