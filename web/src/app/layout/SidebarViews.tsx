// The views at the top of the sidebar, in the order the user set. Drag one (or hold it, or
// right-click it) to start editing: the views shake, can be dragged into a new order or into the
// collapsible group, and hidden or shown; Done saves to the user's settings, Cancel drops it.

import { keyframes } from '@emotion/react';
import {
  Box,
  Button,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { createSavedFilter, savedFiltersOf } from '../../core/savedFilters.ts';
import {
  BUILT_IN_VIEWS,
  defaultSidebar,
  normalizeSidebar,
  filterViewId,
  GROUP,
  moveInOrder,
  setSidebar,
  sidebarOf,
  toggleHidden,
} from '../../core/sidebar.ts';
import type { SidebarLayout } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DragHandleIcon,
  EyeIcon,
  EyeOffIcon,
  FilterIcon,
  PlusIcon,
} from '../icons/icons.tsx';
import { FilterDialog } from '../filters/FilterDialog.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { VIEW_ITEMS } from './navigation.tsx';

const HOLD_MS = 500;

/** A view in the sidebar: built-in ones and the user's saved filters. */
interface ViewItem {
  path: string;
  name: string;
  icon: ReactNode;
}
const DRAG_PX = 6;

const wiggle = keyframes`
  from { transform: rotate(-0.3deg); }
  to { transform: rotate(0.3deg); }
`;

interface Gesture {
  id: string;
  x: number;
  y: number;
  touch: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  dragging: boolean;
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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const filters = savedFiltersOf(workspace);
  // Built-in views, then the user's saved filters.
  const items: Record<string, ViewItem> = {};
  for (const [id, item] of Object.entries(VIEW_ITEMS)) {
    items[id] = { path: item.path, name: t(item.label), icon: item.icon };
  }
  for (const filter of filters) {
    items[filterViewId(filter.id)] = {
      path: `/filters/${filter.id}`,
      name: filter.name,
      icon: <FilterIcon />,
    };
  }
  const views = [...BUILT_IN_VIEWS, ...filters.map((filter) => filterViewId(filter.id))];
  const saved = sidebarOf(workspace, views);
  const [creating, setCreating] = useState(false);
  // Editing works on a copy; Done saves it.
  const [draft, setDraft] = useState<SidebarLayout | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const editing = draft !== null;
  const layout = draft ?? saved;
  const rows = useRef(new Map<string, HTMLElement>());
  const gesture = useRef<Gesture | null>(null);
  // A drag or hold ends in a click; that click must not open the view.
  const swallowClick = useRef(false);

  const startEditing = () => setDraft((current) => current ?? saved);
  const done = () => {
    if (draft) apply((ctx, ws) => setSidebar(ctx, ws, draft), t('undo.sidebar'));
    setDraft(null);
  };
  const cancel = () => setDraft(null);

  const endGesture = () => {
    const current = gesture.current;
    if (current?.timer) clearTimeout(current.timer);
    gesture.current = null;
    setDragging(null);
  };

  const pointerDown = (id: string) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const touch = event.pointerType === 'touch';
    const current: Gesture = {
      id,
      x: event.clientX,
      y: event.clientY,
      touch,
      dragging: false,
      timer: setTimeout(() => {
        // Held still: start editing.
        current.timer = null;
        swallowClick.current = true;
        startEditing();
      }, HOLD_MS),
    };
    gesture.current = current;
  };

  const pointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current) return;
    if (!current.dragging) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_PX) return;
      // A finger moving before editing is a scroll, not a drag.
      if (current.touch && !editing) {
        endGesture();
        return;
      }
      if (current.timer) clearTimeout(current.timer);
      current.timer = null;
      current.dragging = true;
      swallowClick.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      startEditing();
      setDragging(current.id);
    }
    // Drop position: past every row whose middle is above the pointer.
    setDraft((before) => {
      const base = before ?? saved;
      const others = base.order.filter((id) => id !== current.id);
      const index = others.filter((id) => {
        const box = rows.current.get(id)?.getBoundingClientRect();
        return box !== undefined && box.top + box.height / 2 < event.clientY;
      }).length;
      const order = moveInOrder(base.order, current.id, index);
      return order.join() === base.order.join() ? base : { ...base, order };
    });
  };

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
        ref={(element: HTMLElement | null) => {
          if (element) rows.current.set(id, element);
          else rows.current.delete(id);
        }}
        selected={!editing && (selected === item.path || pathname === item.path)}
        onPointerDown={pointerDown(id)}
        onPointerMove={pointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onContextMenu={(event) => {
          event.preventDefault();
          startEditing();
        }}
        onClick={() => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          if (!editing) onNavigate(item.path);
        }}
        sx={{
          pl: inGroup ? 3 : 2,
          userSelect: 'none',
          // While editing, a finger drags instead of scrolling.
          touchAction: editing ? 'none' : 'pan-y',
          opacity: hidden ? 0.45 : 1,
          ...(editing &&
            dragging !== id && {
              animation: `${wiggle} 0.24s ${(index % 3) * 0.06}s ease-in-out infinite alternate`,
            }),
          ...(dragging === id && {
            bgcolor: 'action.selected',
            boxShadow: 3,
            zIndex: 1,
            cursor: 'grabbing',
          }),
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        {editing && (
          <DragHandleIcon
            fontSize="small"
            sx={{ color: 'text.disabled', ml: -1, mr: 0.5, cursor: 'grab' }}
          />
        )}
        <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
        <ListItemText primary={item.name} />
        {editing && (
          <Tooltip title={hidden ? t('nav.showView') : t('nav.hideView')}>
            <IconButton
              size="small"
              edge="end"
              aria-label={t(hidden ? 'nav.showNamed' : 'nav.hideNamed', { name: item.name })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setDraft((before) => toggleHidden(before ?? saved, id));
              }}
            >
              {hidden ? <EyeOffIcon fontSize="small" /> : <EyeIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </ListItemButton>
    );
  };

  return (
    <Box sx={{ position: 'relative' }}>
      {editing && (
        // Laid over the sidebar's title bar, so the views don't move as editing starts.
        <Box
          role="toolbar"
          aria-label={t('nav.editSidebar')}
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: '100%',
            height: 64,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            bgcolor: (theme) => theme.punchlist.surfaceVariant,
          }}
        >
          <Button size="small" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          {/* Back to the default order, nothing hidden; Done still saves it. */}
          <Button size="small" onClick={() => setDraft(normalizeSidebar(defaultSidebar(), views))}>
            {t('nav.resetSidebar')}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Button size="small" variant="contained" onClick={done}>
            {t('common.done')}
          </Button>
        </Box>
      )}
      <List dense>
        {layout.order.map((id, index) => {
          if (id === GROUP) {
            const count = grouped.filter((each) => editing || !layout.hidden.includes(each)).length;
            return (
              <ListItemButton
                key={GROUP}
                ref={(element: HTMLElement | null) => {
                  if (element) rows.current.set(GROUP, element);
                  else rows.current.delete(GROUP);
                }}
                aria-expanded={groupOpen}
                disabled={editing}
                onClick={() =>
                  apply((ctx, ws) => setSidebar(ctx, ws, { ...saved, groupOpen: !saved.groupOpen }))
                }
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
            setDraft((before) => {
              if (!before) return before;
              const at = before.order.indexOf(GROUP);
              const order = [...before.order];
              order.splice(at, 0, filterViewId(id));
              return { ...before, order };
            });
            void navigate(`/filters/${id}`);
          }}
        />
      )}
    </Box>
  );
}
