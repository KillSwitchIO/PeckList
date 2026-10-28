// The views at the top of the sidebar, in the order the user set: built-in views, saved
// filters, and any lists or tags pinned here. In edit mode (see sidebarEdit.tsx) they shake,
// drag into a new order or into the collapsible More group, and hide (views) or unpin (lists and
// tags).

import TagRounded from '@mui/icons-material/TagRounded';
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { filterTasks } from '../../core/filters.ts';
import { inboxList } from '../../core/lists.ts';
import { createSavedFilter, filterOf, savedFiltersOf } from '../../core/savedFilters.ts';
import { viewCounts } from '../../core/viewCounts.ts';
import { openCounts, openTagCounts } from '../../core/queries.ts';
import { useToday } from '../hooks/useToday.ts';
import {
  filterViewId,
  GROUP,
  moveInOrder,
  toggleHidden,
  togglePinned,
} from '../../core/sidebar.ts';
import { t } from '../i18n/i18n.ts';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FilterIcon,
  PinOffIcon,
} from '../icons/icons.tsx';
import { FilterDialog } from '../filters/FilterDialog.tsx';
import { listName } from '../lists/listName.ts';
import { ListMark } from '../lists/ListMark.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { tagIconColor } from '../tags/tagColors.ts';
import { VIEW_ITEMS } from './navigation.tsx';
import { editingRowSx, useSidebarEdit } from './sidebarEditContext.ts';
import { useSortableRows } from './useSortableRows.ts';
import { SortHandle } from './SortHandle.tsx';

/** A row in the views section. */
interface ViewItem {
  path: string;
  name: ReactNode;
  /** Plain name, for accessible labels. */
  label: string;
  icon: ReactNode;
  pinned: boolean;
  /** Open tasks it holds (R-FB-114) */
  count?: number;
  /** A list a dragged task can be dropped on (the Mess Drawer, pinned lists) */
  dropList?: string;
}

/**
 * A path that keeps its end when it doesn't fit: `home/garden/beds` becomes `…den/beds`. (Right
 * to left puts the ellipsis at the start; the marks keep the text itself left to right.)
 */
export function PathText({ path }: { path: string }) {
  return (
    <Box
      component="span"
      title={path}
      sx={{
        display: 'block',
        direction: 'rtl',
        textAlign: 'left',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {`‎${path}‎`}
    </Box>
  );
}

export function SidebarViews({
  selected,
  onNavigate,
  flat = false,
}: {
  selected: string | false;
  onNavigate: (path: string) => void;
  /** Show the More group's views without its fold (the phone's More page), except while editing. */
  flat?: boolean;
}) {
  const workspace = useWorkspace();
  const today = useToday();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const counts = useMemo(() => viewCounts(workspace, today, me), [workspace, today, me]);
  const listCounts = useMemo(() => openCounts(workspace), [workspace]);
  const tagCounts = useMemo(() => openTagCounts(workspace), [workspace]);
  const theme = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const edit = useSidebarEdit();
  const { editing } = edit;
  const layout = edit.current.layout;

  // Built-in views, saved filters, then pinned lists and tags.
  const items: Record<string, ViewItem> = {};
  for (const [id, item] of Object.entries(VIEW_ITEMS)) {
    const name = t(item.label);
    items[id] = { path: item.path, name, label: name, icon: item.icon, pinned: false };
  }
  items.inbox = { ...items.inbox!, dropList: inboxList(workspace).id };
  // Counts beside the views, as the lists have (R-FB-114).
  for (const [id, count] of Object.entries(counts)) {
    if (items[id] && count !== undefined) items[id] = { ...items[id], count };
  }
  for (const filter of savedFiltersOf(workspace)) {
    items[filterViewId(filter.id)] = {
      path: `/filters/${filter.id}`,
      name: filter.name,
      label: filter.name,
      icon: <FilterIcon />,
      pinned: false,
      count: filterTasks(workspace, filterOf(filter), today).length,
    };
  }
  for (const id of layout.order) {
    const [kind, entityId = ''] = id.split(':');
    if (kind === 'list') {
      const list = getEntity(workspace, 'lists', entityId);
      if (!list || !isLive(list)) continue;
      items[id] = {
        dropList: list.id,
        path: `/lists/${list.id}`,
        name: listName(list, workspace),
        label: listName(list, workspace),
        icon: <ListMark list={list} sx={{ mx: list.icon ? '3px' : '7px' }} />,
        pinned: true,
        // Its open tasks, as in the Lists section.
        count: listCounts.get(list.id) ?? 0,
      };
    } else if (kind === 'tag') {
      const tag = getEntity(workspace, 'tags', entityId);
      if (!tag || !isLive(tag)) continue;
      items[id] = {
        path: `/tags/${tag.id}`,
        // The whole path, so a pinned tag says where it lives.
        name: <PathText path={tag.name} />,
        label: tag.name,
        icon: (
          <TagRounded
            sx={{ fontSize: 18, color: tagIconColor(tag.color, theme.palette.background.default) }}
          />
        ),
        pinned: true,
        // Its open tasks, as in the Tags section.
        count: tagCounts.get(tag.id) ?? 0,
      };
    }
  }

  const sortable = useSortableRows({
    editing,
    start: edit.start,
    onDrag: (id, y) =>
      edit.update((draft) => {
        const order = draft.layout.order;
        const index = sortable.slot(
          order.filter((each) => each !== id),
          y,
        );
        const next = moveInOrder(order, id, index);
        return next.join() === order.join()
          ? draft
          : { ...draft, layout: { ...draft.layout, order: next } };
      }),
  });

  const groupAt = layout.order.indexOf(GROUP);
  const grouped = layout.order.slice(groupAt + 1);
  const unfolded = flat && !editing;
  const groupOpen = unfolded || layout.groupOpen;

  const row = (item: ViewItem, id: string, index: number) => {
    const hidden = layout.hidden.includes(id);
    if (hidden && !editing) return null;
    const inGroup = index > groupAt;
    if (inGroup && !groupOpen) return null;
    return (
      <ListItemButton
        key={id}
        {...sortable.rowProps(id)}
        selected={!editing && (selected === item.path || pathname === item.path)}
        onClick={sortable.click(() => {
          if (!editing) onNavigate(item.path);
        })}
        // The Mess Drawer and pinned lists take a dragged task too.
        {...(item.dropList ? { 'data-drop-list': item.dropList } : {})}
        sx={{
          '&.drop-hover': {
            bgcolor: 'action.selected',
            boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
          },
          pl: inGroup && !unfolded ? 3 : 2,
          opacity: hidden ? 0.45 : 1,
          ...editingRowSx(editing, sortable.dragging === id, index),
        }}
      >
        {editing && <SortHandle />}
        <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
        <ListItemText primary={item.name} sx={{ minWidth: 0 }} />
        {!editing && item.count !== undefined && item.count > 0 && (
          <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>
            {item.count}
          </Box>
        )}
        {editing &&
          (item.pinned ? (
            <Tooltip title={t('nav.unpin')}>
              <IconButton
                size="small"
                edge="end"
                aria-label={t('nav.unpinNamed', { name: item.label })}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  edit.update((draft) => ({ ...draft, layout: togglePinned(draft.layout, id) }));
                }}
              >
                <PinOffIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title={hidden ? t('nav.showView') : t('nav.hideView')}>
              <IconButton
                size="small"
                edge="end"
                aria-label={t(hidden ? 'nav.showNamed' : 'nav.hideNamed', { name: item.label })}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  edit.update((draft) => ({ ...draft, layout: toggleHidden(draft.layout, id) }));
                }}
              >
                {hidden ? <EyeOffIcon fontSize="small" /> : <EyeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ))}
      </ListItemButton>
    );
  };

  return (
    <Box>
      <List dense>
        {layout.order.map((id, index) => {
          if (id === GROUP) {
            if (unfolded) return null;
            const count = grouped.filter((each) => editing || !layout.hidden.includes(each)).length;
            return (
              <ListItemButton
                key={GROUP}
                ref={sortable.rowProps(GROUP).ref}
                aria-expanded={groupOpen}
                onClick={() =>
                  editing
                    ? edit.update((draft) => ({
                        ...draft,
                        layout: { ...draft.layout, groupOpen: !draft.layout.groupOpen },
                      }))
                    : edit.saveLayout({ ...layout, groupOpen: !layout.groupOpen })
                }
                sx={{
                  py: 0.25,
                  minHeight: 32,
                  color: 'text.secondary',
                }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                  {groupOpen ? (
                    <ChevronDownIcon fontSize="small" />
                  ) : (
                    <ChevronRightIcon fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={t('nav.group')}
                  slotProps={{ primary: { variant: 'caption', sx: { fontWeight: 600 } } }}
                />
                {!groupOpen && count > 0 && (
                  <Typography variant="caption" color="text.disabled">
                    {count}
                  </Typography>
                )}
              </ListItemButton>
            );
          }
          const item = items[id];
          return item ? row(item, id, index) : null;
        })}
      </List>
      {edit.creatingFilter && (
        <FilterDialog
          onClose={() => edit.setCreatingFilter(false)}
          onSave={(name, filter) => {
            let id = '';
            apply((ctx, ws) => {
              const made = createSavedFilter(ctx, ws, name, filter);
              id = made.filter.id;
              return made.workspace;
            }, t('undo.filterCreated'));
            edit.setCreatingFilter(false);
            // The new filter joins the layout being edited, above the group.
            edit.update((draft) => {
              const order = [...draft.layout.order];
              order.splice(order.indexOf(GROUP), 0, filterViewId(id));
              return { ...draft, layout: { ...draft.layout, order } };
            });
            void navigate(`/filters/${id}`);
          }}
        />
      )}
    </Box>
  );
}
