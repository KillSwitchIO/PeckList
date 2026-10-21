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
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { createSavedFilter, savedFiltersOf } from '../../core/savedFilters.ts';
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
  DragHandleIcon,
  EyeIcon,
  EyeOffIcon,
  FilterIcon,
  PinOffIcon,
  PlusIcon,
} from '../icons/icons.tsx';
import { FilterDialog } from '../filters/FilterDialog.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { tagIconColor } from '../tags/tagColors.ts';
import { VIEW_ITEMS } from './navigation.tsx';
import { editingRowSx, useSidebarEdit } from './sidebarEditContext.ts';
import { useSortableRows } from './useSortableRows.ts';

/** A row in the views section. */
interface ViewItem {
  path: string;
  name: ReactNode;
  /** Plain name, for accessible labels. */
  label: string;
  icon: ReactNode;
  pinned: boolean;
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
}: {
  selected: string | false;
  onNavigate: (path: string) => void;
}) {
  const workspace = useWorkspace();
  const apply = useApply();
  const theme = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const edit = useSidebarEdit();
  const { editing } = edit;
  const layout = edit.current.layout;
  const [creating, setCreating] = useState(false);

  // Built-in views, saved filters, then pinned lists and tags.
  const items: Record<string, ViewItem> = {};
  for (const [id, item] of Object.entries(VIEW_ITEMS)) {
    const name = t(item.label);
    items[id] = { path: item.path, name, label: name, icon: item.icon, pinned: false };
  }
  for (const filter of savedFiltersOf(workspace)) {
    items[filterViewId(filter.id)] = {
      path: `/filters/${filter.id}`,
      name: filter.name,
      label: filter.name,
      icon: <FilterIcon />,
      pinned: false,
    };
  }
  for (const id of layout.order) {
    const [kind, entityId = ''] = id.split(':');
    if (kind === 'list') {
      const list = getEntity(workspace, 'lists', entityId);
      if (!list || !isLive(list)) continue;
      items[id] = {
        path: `/lists/${list.id}`,
        name: listName(list),
        label: listName(list),
        icon: (
          <Box
            sx={{ width: 10, height: 10, mx: '7px', borderRadius: '50%', bgcolor: list.color }}
          />
        ),
        pinned: true,
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
  const groupOpen = editing || layout.groupOpen;

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
        sx={{
          pl: inGroup ? 3 : 2,
          opacity: hidden ? 0.45 : 1,
          ...editingRowSx(editing, sortable.dragging === id, index),
        }}
      >
        {editing && (
          <DragHandleIcon
            fontSize="small"
            sx={{ color: 'text.disabled', ml: -1, mr: 0.5, cursor: 'grab' }}
          />
        )}
        <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
        <ListItemText primary={item.name} sx={{ minWidth: 0 }} />
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
            const count = grouped.filter((each) => editing || !layout.hidden.includes(each)).length;
            return (
              <ListItemButton
                key={GROUP}
                ref={sortable.rowProps(GROUP).ref}
                aria-expanded={groupOpen}
                disabled={editing}
                onClick={() => edit.saveLayout({ ...layout, groupOpen: !layout.groupOpen })}
                sx={{
                  py: 0.25,
                  minHeight: 32,
                  color: 'text.secondary',
                  '&.Mui-disabled': { opacity: 1 },
                  ...(editing && { borderTop: 1, borderColor: 'divider', mt: 0.5 }),
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
        {editing && (
          <ListItemButton onClick={() => setCreating(true)} sx={{ color: 'text.secondary' }}>
            <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
              <PlusIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={t('filter.new')} />
          </ListItemButton>
        )}
      </List>
      {creating && (
        <FilterDialog
          onClose={() => setCreating(false)}
          onSave={(name, filter) => {
            let id = '';
            apply((ctx, ws) => {
              const made = createSavedFilter(ctx, ws, name, filter);
              id = made.filter.id;
              return made.workspace;
            }, t('undo.filterCreated'));
            setCreating(false);
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
