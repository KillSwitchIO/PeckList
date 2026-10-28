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
import { MAX_TABS, SEARCH_TAB, toggleTab } from '../../core/bottomBar.ts';
import { moveInOrder } from '../../core/sidebar.ts';
import { t } from '../i18n/i18n.ts';
import { useTabs, type Tab } from './bottomTabs.tsx';
import { editingRowSx, useSidebarEdit } from './sidebarEditContext.ts';
import { useSortableRows } from './useSortableRows.ts';
import { SortHandle } from './SortHandle.tsx';

/**
 * The More page's editor for the phone's bottom bar: its tabs in order (drag to sort, minus to
 * take one out), then the other views to add while there is room. More always comes last.
 */
export function BottomBarEditor() {
  const edit = useSidebarEdit();
  const tabs = edit.current.bottomBar;
  const shown = useTabs(tabs);
  const others = useTabs([...edit.views, SEARCH_TAB].filter((id) => !tabs.includes(id)));
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
                aria-label={t('bottomBar.remove', { name: tab.label })}
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
            <ListItemText primary={tab.label} />
          </ListItem>
        ))}
      </List>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2 }}>
        {full ? t('bottomBar.full', { count: MAX_TABS }) : t('bottomBar.moreLast')}
      </Typography>
      <List dense aria-label={t('bottomBar.add')}>
        {others.map((tab) => (
          <ListItem
            key={tab.id}
            secondaryAction={
              <IconButton
                edge="end"
                size="small"
                disabled={full}
                aria-label={t('bottomBar.addNamed', { name: tab.label })}
                onClick={() => toggle(tab)}
              >
                <AddCircleOutlineRounded fontSize="small" color={full ? 'disabled' : 'primary'} />
              </IconButton>
            }
            sx={{ opacity: full ? 0.6 : 1 }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>{tab.icon}</ListItemIcon>
            <ListItemText primary={tab.label} />
          </ListItem>
        ))}
      </List>
    </>
  );
}
