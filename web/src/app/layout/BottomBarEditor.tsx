import AddCircleOutlineRounded from '@mui/icons-material/AddCircleOutlineRounded';
import RemoveCircleOutlineRounded from '@mui/icons-material/RemoveCircleOutlineRounded';
import {
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Typography,
} from '@mui/material';
import { MAX_TABS, toggleTab } from '../../core/bottomBar.ts';
import { moveInOrder, pinnedListId, pinnedTagId } from '../../core/sidebar.ts';
import { t } from '../i18n/i18n.ts';
import { useTabs, type Tab } from './bottomTabs.tsx';
import { editingRowSx, useSidebarEdit } from './sidebarEditContext.ts';
import { useSortableRows } from './useSortableRows.ts';
import { SortHandle } from './SortHandle.tsx';

/** A long name ends in an ellipsis rather than running under the row's button. */
const ONE_LINE = { primary: { noWrap: true } };

/**
 * The More page's editor for the phone's bottom bar: its tabs in order (drag to sort, minus to
 * take one out), then the other views, lists and tags to add while there is room. More always
 * comes last.
 */
export function BottomBarEditor() {
  const edit = useSidebarEdit();
  const tabs = edit.current.bottomBar;
  const shown = useTabs(tabs);
  const absent = (id: string) => !tabs.includes(id);
  const others = useTabs(edit.views.filter(absent));
  const lists = useTabs(edit.current.lists.map(pinnedListId).filter(absent));
  const tags = useTabs(edit.current.tags.map(pinnedTagId).filter(absent));
  const full = tabs.length >= MAX_TABS;
  const sortable = useSortableRows({
    editing: true,
    start: edit.start,
    onDrag: (id, y) =>
      edit.update((draft) => {
        const order = draft.bottomBar;
        const index = sortable.slot(
          order.filter((each) => each !== id),
          y,
        );
        const next = moveInOrder(order, id, index);
        return next.join() === order.join() ? draft : { ...draft, bottomBar: next };
      }),
  });
  const toggle = (tab: Tab) =>
    edit.update((draft) => ({ ...draft, bottomBar: toggleTab(draft.bottomBar, tab.id) }));
  const addRow = (tab: Tab) => (
    <ListItem
      key={tab.id}
      secondaryAction={
        <IconButton
          edge="end"
          size="small"
          disabled={full}
          aria-label={t('bottomBar.addNamed', { name: tab.fullLabel ?? tab.label })}
          onClick={() => toggle(tab)}
        >
          <AddCircleOutlineRounded fontSize="small" color={full ? 'disabled' : 'primary'} />
        </IconButton>
      }
      sx={{ opacity: full ? 0.6 : 1 }}
    >
      <ListItemIcon sx={{ minWidth: 40 }}>{tab.icon}</ListItemIcon>
      <ListItemText primary={tab.fullName ?? tab.label} slotProps={ONE_LINE} />
    </ListItem>
  );
  const group = (title: string, rows: Tab[]) =>
    rows.length > 0 && [
      <ListSubheader key={title} disableSticky sx={{ bgcolor: 'transparent', lineHeight: '36px' }}>
        {title}
      </ListSubheader>,
      ...rows.map(addRow),
    ];

  return (
    <>
      <List
        dense
        aria-label={t('bottomBar.title')}
        subheader={
          <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '36px' }}>
            {t('bottomBar.title')} ({tabs.length}/{MAX_TABS})
          </ListSubheader>
        }
      >
        {shown.map((tab, index) => (
          <ListItem
            key={tab.id}
            {...sortable.rowProps(tab.id)}
            secondaryAction={
              <IconButton
                edge="end"
                size="small"
                aria-label={t('bottomBar.remove', { name: tab.fullLabel ?? tab.label })}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => toggle(tab)}
              >
                <RemoveCircleOutlineRounded fontSize="small" color="error" />
              </IconButton>
            }
            sx={editingRowSx(true, sortable.dragging === tab.id, index)}
          >
            <SortHandle />
            <ListItemIcon sx={{ minWidth: 40 }}>{tab.icon}</ListItemIcon>
            <ListItemText primary={tab.fullName ?? tab.label} slotProps={ONE_LINE} />
          </ListItem>
        ))}
      </List>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2 }}>
        {full ? t('bottomBar.full', { count: MAX_TABS }) : t('bottomBar.moreLast')}
      </Typography>
      <List dense aria-label={t('bottomBar.add')}>
        {others.map(addRow)}
        {group(t('nav.lists'), lists)}
        {group(t('nav.tags'), tags)}
      </List>
    </>
  );
}
