import CheckRounded from '@mui/icons-material/CheckRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import NorthRounded from '@mui/icons-material/NorthRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import SouthRounded from '@mui/icons-material/SouthRounded';
import { Box, Divider, IconButton, ListSubheader, Menu, MenuItem, Tooltip } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { LIST_SORTS, type ListGrouping } from '../../core/listView.ts';
import { t } from '../i18n/i18n.ts';
import type { ListViewSettings } from '../lists/listGrouping.ts';
import { useBulkSelect } from '../tasks/bulkSelect.ts';

export type ListLayout = 'list' | 'timeline';

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

const subheader = (key: string, text: string) => (
  <ListSubheader key={key} sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
    {text}
  </ListSubheader>
);

/**
 * The view menu in a list's or a view's header, the three dots (spec: Views, sort and group
 * options; R-FB-55): Select to pick many tasks, List or Timeline where a list has both, then
 * group and sort, with Restore defaults to go back to how the view comes. Picking the chosen
 * grouping or sort again turns it around.
 */
export function SortGroupButton({
  view,
  groupings,
  fixed = [],
  layout,
}: {
  view: ListViewSettings;
  groupings: readonly ListGrouping[];
  /** Groupings that have one way only here (Upcoming's days) */
  fixed?: readonly ListGrouping[];
  /** A list's List or Timeline, where it has both */
  layout?: { value: ListLayout; onChange: (next: ListLayout) => void };
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const bulk = useBulkSelect();
  const close = () => setAnchor(null);
  const timeline = layout?.value === 'timeline';

  const items: ReactNode[] = [];
  if (bulk && !timeline) {
    items.push(
      <MenuItem
        key="select"
        dense
        onClick={() => {
          close();
          bulk.start();
        }}
      >
        <RadioButtonUncheckedRounded fontSize="small" sx={{ mr: 1 }} />
        {t('bulk.select')}
      </MenuItem>,
    );
  }
  if (layout) {
    items.push(subheader('layout', t('list.layout')));
    for (const each of ['list', 'timeline'] as const) {
      items.push(
        <MenuItem
          key={`layout-${each}`}
          dense
          selected={layout.value === each}
          onClick={() => {
            close();
            layout.onChange(each);
          }}
        >
          {t(`list.layout.${each}`)}
          {layout.value === each && <Picked turns={false} reversed={false} />}
        </MenuItem>,
      );
    }
  }
  if (!timeline) {
    if (items.length > 0) items.push(<Divider key="before-group" />);
    items.push(subheader('group', t('list.groupBy')));
    for (const mode of groupings) {
      items.push(
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
        </MenuItem>,
      );
    }
    items.push(subheader('sort', t('list.sortBy')));
    for (const mode of LIST_SORTS) {
      items.push(
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
          {view.sort === mode && <Picked turns={mode !== 'manual'} reversed={view.sortReversed} />}
        </MenuItem>,
      );
    }
    items.push(<Divider key="before-reset" />);
    items.push(
      <MenuItem
        key="reset"
        dense
        disabled={view.isDefault}
        onClick={() => {
          close();
          view.reset();
        }}
      >
        <RestartAltRounded fontSize="small" sx={{ mr: 1 }} />
        {t('list.restoreDefaults')}
      </MenuItem>,
    );
  }

  return (
    <>
      <Tooltip title={t('list.viewOptions')} disableFocusListener>
        <IconButton
          aria-label={t('list.viewOptions')}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ color: view.isDefault ? undefined : 'primary.main' }}
        >
          <MoreVertRounded />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        {items}
      </Menu>
    </>
  );
}
