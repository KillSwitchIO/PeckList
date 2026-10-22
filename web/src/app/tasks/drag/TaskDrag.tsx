// Dragging tasks in a list (spec: PL-014). Rows stay where they are while dragging (no layout
// shifts): the task and its subtasks dim, a line shows where it will land, indented to the depth
// it will take ("kicked over" under its new parent), and a small label follows the pointer.
// Drop zones and rows are found through data attributes, so rows need no registering:
// `data-drag-zone` on each section's list (with `data-list` and `data-section`), `data-drag-row`
// and `data-depth` on each row, `data-drop-list` on sidebar lists that take a dropped task.

import { Box, Paper, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getEntity } from '../../../core/collections.ts';
import { projectDrop, type Drop, type DragRow } from '../../../core/taskDrag.ts';
import { descendants, moveTask } from '../../../core/tasks.ts';
import type { Id, Task } from '../../../core/types.ts';
import { t } from '../../i18n/i18n.ts';
import { listName } from '../../lists/listName.ts';
import { useApply, useWorkspace } from '../../store/hooks.ts';
import { DRAG_INDENT, DragContext, type DragApi } from './dragContext.ts';

const START_PX = 6;
const HOLD_MS = 450;

interface Line {
  top: number;
  left: number;
  width: number;
}

interface Active {
  id: Id;
  title: string;
  depth: number;
  hidden: Set<Id>;
  x: number;
  y: number;
}

const EMPTY = new Set<Id>();

/** Rows of a zone as the drop sees them, without the dragged subtree. */
function zoneRows(zone: Element, hidden: ReadonlySet<Id>) {
  return [...zone.querySelectorAll<HTMLElement>('[data-drag-row]')]
    .filter((row) => !hidden.has(row.dataset.dragRow!))
    .map((row) => ({
      id: row.dataset.dragRow!,
      depth: Number(row.dataset.depth ?? 0),
      box: row.getBoundingClientRect(),
    }));
}

/** The zone under (or nearest to) a height on screen. */
function zoneAt(root: Element, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let distance = Infinity;
  for (const zone of root.querySelectorAll<HTMLElement>('[data-drag-zone]')) {
    const box = zone.getBoundingClientRect();
    const away = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
    if (away < distance) {
      distance = away;
      best = zone;
    }
  }
  return best;
}

/**
 * Lets the task rows inside drag: up and down to reorder (across sections), right to nest under
 * the task above, left to outdent, or onto a list in the sidebar to move it there.
 */
export function TaskDragProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const root = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const drop = useRef<(Drop & { listId: Id; sectionId: Id | null }) | null>(null);
  const hoverList = useRef<HTMLElement | null>(null);
  const swallowClick = useRef(false);
  // Latest workspace for the window listeners.
  const latest = useRef(workspace);
  useEffect(() => {
    latest.current = workspace;
  }, [workspace]);

  const setHover = (element: HTMLElement | null) => {
    if (hoverList.current === element) return;
    hoverList.current?.classList.remove('drop-hover');
    element?.classList.add('drop-hover');
    hoverList.current = element;
  };

  const track = useCallback((current: Active, x: number, y: number) => {
    setPointer({ x, y });
    const target = document.elementFromPoint?.(x, y)?.closest<HTMLElement>('[data-drop-list]');
    setHover(target ?? null);
    if (target || !root.current) {
      setLine(null);
      drop.current = null;
      return;
    }
    const zone = zoneAt(root.current, y);
    if (!zone) return;
    const rows = zoneRows(zone, current.hidden);
    const index = rows.filter((row) => row.box.top + row.box.height / 2 < y).length;
    const listId = zone.dataset.list!;
    const sectionId = zone.dataset.section || null;
    const wanted = current.depth + Math.round((x - current.x) / DRAG_INDENT);
    const projected = projectDrop(
      latest.current,
      current.id,
      listId,
      sectionId,
      rows.map((row): DragRow => ({ id: row.id, depth: row.depth })),
      index,
      wanted,
    );
    drop.current = { ...projected, listId, sectionId };
    const zoneBox = zone.getBoundingClientRect();
    const top =
      index < rows.length
        ? rows[index]!.box.top
        : rows.length > 0
          ? rows[rows.length - 1]!.box.bottom
          : zoneBox.top + 2;
    const left = zoneBox.left + 8 + projected.depth * DRAG_INDENT;
    setLine({ top, left, width: Math.max(40, zoneBox.right - left - 8) });
  }, []);

  const finish = useCallback(
    (current: Active, commit: boolean) => {
      const listTarget = hoverList.current?.dataset.dropList;
      setHover(null);
      setActive(null);
      setLine(null);
      setPointer(null);
      const landing = drop.current;
      drop.current = null;
      if (!commit) return;
      if (listTarget) {
        const list = getEntity(latest.current, 'lists', listTarget);
        apply(
          (ctx, ws) => moveTask(ctx, ws, current.id, { listId: listTarget, parentId: null }),
          t('undo.movedTo', { list: list ? listName(list) : '' }),
        );
      } else if (landing) {
        apply((ctx, ws) => moveTask(ctx, ws, current.id, landing.target), t('undo.moved'));
      }
    },
    [apply],
  );

  // While dragging, the whole window follows the pointer; Escape calls it off.
  useEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => {
      event.preventDefault();
      track(active, event.clientX, event.clientY);
    };
    const up = () => finish(active, true);
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(active, false);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [active, track, finish]);

  const begin = useCallback((task: Task, depth: number, x: number, y: number) => {
    const hidden = new Set<Id>([
      task.id,
      ...descendants(latest.current, task.id).map((each) => each.id),
    ]);
    swallowClick.current = true;
    const current = { id: task.id, title: task.title || t('task.untitled'), depth, hidden, x, y };
    setActive(current);
    return current;
  }, []);

  const api = useMemo<DragApi>(
    () => ({
      dimmed: active?.hidden ?? EMPTY,
      gesture: (task, depth, onMenu) => ({
        onPointerDown: (event) => {
          if (event.button !== 0 || active) return;
          const startX = event.clientX;
          const startY = event.clientY;
          const touch = event.pointerType === 'touch';
          let armed = !touch;
          let started = false;
          const hold = touch
            ? setTimeout(() => {
                armed = true;
                navigator.vibrate?.(10);
              }, HOLD_MS)
            : null;
          const cleanup = () => {
            if (hold) clearTimeout(hold);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
          };
          const move = (moved: PointerEvent) => {
            const far = Math.hypot(moved.clientX - startX, moved.clientY - startY) >= START_PX;
            if (!far) return;
            // A finger moving before the hold is a scroll, not a drag.
            if (!armed) {
              cleanup();
              return;
            }
            started = true;
            cleanup();
            track(begin(task, depth, startX, startY), moved.clientX, moved.clientY);
          };
          const up = () => {
            cleanup();
            // A held finger let go without moving: the task menu, as before.
            if (touch && armed && !started) {
              swallowClick.current = true;
              onMenu({ top: startY, left: startX });
            }
          };
          const cancel = () => cleanup();
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', cancel);
        },
        onClickCapture: (event) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        },
      }),
    }),
    [active, begin, track],
  );

  return (
    <DragContext.Provider value={api}>
      <Box ref={root}>{children}</Box>
      {active &&
        createPortal(
          <>
            {line && (
              <Box
                data-testid="drop-line"
                aria-hidden
                sx={{
                  position: 'fixed',
                  top: line.top - 1,
                  left: line.left,
                  width: line.width,
                  height: 2,
                  bgcolor: 'primary.main',
                  borderRadius: 1,
                  pointerEvents: 'none',
                  zIndex: (theme) => theme.zIndex.tooltip,
                  // A dot where the row will start, so the indent reads at a glance.
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: -4,
                    top: -3,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    border: 2,
                    borderColor: 'primary.main',
                    bgcolor: 'background.paper',
                  },
                }}
              />
            )}
            {pointer && (
              <Paper
                aria-hidden
                elevation={4}
                sx={{
                  position: 'fixed',
                  top: pointer.y + 10,
                  left: pointer.x + 12,
                  px: 1.25,
                  py: 0.5,
                  maxWidth: 260,
                  borderRadius: 2,
                  pointerEvents: 'none',
                  zIndex: (theme) => theme.zIndex.tooltip,
                }}
              >
                <Typography variant="body2" noWrap>
                  {active.title}
                </Typography>
              </Paper>
            )}
          </>,
          document.body,
        )}
    </DragContext.Provider>
  );
}
