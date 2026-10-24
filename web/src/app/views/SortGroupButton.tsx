import CheckRounded from '@mui/icons-material/CheckRounded';
import NorthRounded from '@mui/icons-material/NorthRounded';
import SouthRounded from '@mui/icons-material/SouthRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import { Box, Divider, IconButton, ListSubheader, Menu, MenuItem, Tooltip } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { LIST_SORTS, type ListGrouping } from '../../core/listView.ts';
import { t } from '../i18n/i18n.ts';
import { SortGroupIcon } from '../icons/icons.tsx';
import type { ListViewSettings } from '../lists/listGrouping.ts';

/** The picked option's mark: a tick, with an arrow for which way it runs when it can turn. */
function Picked({ turns, reversed }: { turns: boolean; reversed: boolean }): ReactNode {
  const style = { fontSize: 18 };
  return (
    <Box
      component="span"
      sx={{ ml: 'auto', pl: 1, display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
    >
      {turns &&
        (reversed ? (
          <NorthRounded sx={style} aria-label={t('list.reversed')} />
        ) : (
          <SouthRounded sx={style} />
        ))}
      <CheckRounded fontSize="small" />
    </Box>
  );
}

/**
 * The sort and group button in a list's or a view's header (spec: Views, sort and group options),
 * with Restore defaults to go back to how the view comes. Picking the chosen grouping or sort
 * again turns it around.
 */
export function SortGroupButton({
  view,
  groupings,
  fixed = [],
}: {
  view: ListViewSettings;
  groupings: readonly ListGrouping[];
  /** Groupings that have one way only here (Upcoming's days) */
  fixed?: readonly ListGrouping[];
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
              if (view.grouping === mode && fixed.includes(mode)) return;
              view.setGrouping(mode);
            }}
          >
            {t(`list.group.${mode}`)}
            {view.grouping === mode && (
              <Picked
                turns={mode !== 'none' && !fixed.includes(mode)}
                reversed={view.groupReversed}
              />
            )}
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
            {view.sort === mode && (
              <Picked turns={mode !== 'manual'} reversed={view.sortReversed} />
            )}
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
