// Dragging tasks in a list (spec: PL-014). Rows stay where they are while dragging (no layout
// shifts): the task and its subtasks dim, a line shows where it will land, indented to the depth
// it will take ("kicked over" under its new parent), and a small label follows the pointer.
// Drop zones and rows are found through data attributes, so rows need no registering:
// `data-drag-zone` on the list's rows (with `data-list`), `data-drag-row`
// and `data-depth` on each row, `data-drop-list` on sidebar lists that take a dropped task.

import { Box, Paper, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getEntity } from '../../../core/collections.ts';
import { projectDrop, type Drop, type DragRow } from '../../../core/taskDrag.ts';
import { canNestUnder, descendants, moveTask } from '../../../core/tasks.ts';
import { dropIntoGroup, type GroupTarget } from '../../../core/groupDrop.ts';
import { localTimeZone } from '../../../core/dates.ts';
import type { Id, Task } from '../../../core/types.ts';
import { t } from '../../i18n/i18n.ts';
import { listName } from '../../lists/listName.ts';
import { useApply, useWorkspace } from '../../store/hooks.ts';
import { DRAG_INDENT, DragContext, type DragApi } from './dragContext.ts';

const START_PX = 6;
const HOLD_MS = 450;
/** The middle of a row (this share of its height off each edge) drops onto it: a subtask. */
const ONTO_EDGE = 0.3;

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
  /** The group it was dragged out of, if its rows stand for one */
  from?: GroupTarget;
  /** Where its row was, for the card that follows the finger */
  row: { left: number; width: number; height: number; grab: number };
}

type Landing = (Drop & { listId: Id; onto?: Id }) | { group: GroupTarget };

/** The group a zone stands for: null for a list's own order, or a zone that takes no drops. */
function groupOf(zone: Element): GroupTarget | null {
  const { dropKind, dropValue, dropUntil } = (zone as HTMLElement).dataset;
  if (!dropKind || dropKind === 'none' || dropValue === undefined) return null;
  return {
    kind: dropKind as GroupTarget['kind'],
    value: dropValue,
    ...(dropUntil ? { until: dropUntil } : {}),
  };
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
    // Rows there drag out, nothing drops in.
    if (zone.dataset.dropKind === 'none') continue;
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
 * Lets the task rows inside drag: up and down to reorder, right to nest under
 * the task above, left to outdent, or onto a list in the sidebar to move it there.
 */
export function TaskDragProvider({
  children,
  onReorder,
}: {
  children: ReactNode;
  /** After a task is put in a new place in a list's order (a list sorted otherwise switches to it) */
  onReorder?: () => void;
}) {
  const workspace = useWorkspace();
  const apply = useApply();
  const root = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [onto, setOnto] = useState<DOMRect | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const drop = useRef<Landing | null>(null);
  const reordered = useRef(onReorder);
  useEffect(() => {
    reordered.current = onReorder;
  });
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
      setOnto(null);
      drop.current = null;
      return;
    }
    const zone = zoneAt(root.current, y);
    if (!zone) return;
    const rows = zoneRows(zone, current.hidden);
    const group = groupOf(zone);
    if (group) {
      // A group: the task takes its value; the line shows the group it goes into.
      setOnto(null);
      const index = rows.filter((row) => row.box.top + row.box.height / 2 < y).length;
      const zoneBox = zone.getBoundingClientRect();
      const top =
        index < rows.length
          ? rows[index]!.box.top
          : rows.length > 0
            ? rows[rows.length - 1]!.box.bottom
            : zoneBox.top + 2;
      drop.current = { group };
      setLine({ top, left: zoneBox.left + 8, width: Math.max(40, zoneBox.width - 16) });
      return;
    }
    // Over the middle of a row that can take it: onto that task, as its last subtask.
    const over = rows.find(
      (row) =>
        y >= row.box.top + row.box.height * ONTO_EDGE &&
        y <= row.box.bottom - row.box.height * ONTO_EDGE,
    );
    if (over && canNestUnder(latest.current, current.id, over.id)) {
      drop.current = {
        depth: over.depth + 1,
        target: {
          listId: zone.dataset.list!,
          parentId: over.id,
        },
        listId: zone.dataset.list!,
        onto: over.id,
      };
      setLine(null);
      setOnto(over.box);
      return;
    }
    setOnto(null);
    const index = rows.filter((row) => row.box.top + row.box.height / 2 < y).length;
    const listId = zone.dataset.list!;
    const wanted = current.depth + Math.round((x - current.x) / DRAG_INDENT);
    const projected = projectDrop(
      latest.current,
      current.id,
      listId,
      rows.map((row): DragRow => ({ id: row.id, depth: row.depth })),
      index,
      wanted,
    );
    drop.current = { ...projected, listId };
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
      setOnto(null);
      setPointer(null);
      const landing = drop.current;
      drop.current = null;
      if (!commit) return;
      if (listTarget) {
        const list = getEntity(latest.current, 'lists', listTarget);
        apply(
          (ctx, ws) => moveTask(ctx, ws, current.id, { listId: listTarget, parentId: null }),
          t('undo.movedTo', { list: list ? listName(list, latest.current) : '' }),
        );
      } else if (landing && 'group' in landing) {
        apply(
          (ctx, ws) =>
            dropIntoGroup(ctx, ws, current.id, landing.group, current.from, localTimeZone()),
          t('undo.moved'),
        );
      } else if (landing?.onto) {
        const parent = getEntity(latest.current, 'tasks', landing.onto);
        apply(
          (ctx, ws) => moveTask(ctx, ws, current.id, landing.target),
          t('undo.nested', { title: parent?.title || t('task.untitled') }),
        );
      } else if (landing) {
        apply((ctx, ws) => moveTask(ctx, ws, current.id, landing.target), t('undo.moved'));
        reordered.current?.();
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
    // A finger dragging a task moves the task, not the page.
    const still = (event: TouchEvent) => event.preventDefault();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
    document.addEventListener('touchmove', still, { passive: false });
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('touchmove', still);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [active, track, finish]);

  const begin = useCallback((task: Task, depth: number, x: number, y: number, source: Element) => {
    const hidden = new Set<Id>([
      task.id,
      ...descendants(latest.current, task.id).map((each) => each.id),
    ]);
    swallowClick.current = true;
    const rowBox = (source.closest('[data-drag-row]') ?? source).getBoundingClientRect();
    const zone = source.closest('[data-drag-zone]');
    const from = zone ? groupOf(zone) : null;
    const current: Active = {
      id: task.id,
      title: task.title || t('task.untitled'),
      depth,
      hidden,
      x,
      y,
      ...(from ? { from } : {}),
      row: { left: rowBox.left, width: rowBox.width, height: rowBox.height, grab: y - rowBox.top },
    };
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
          const source = event.currentTarget;
          const touch = event.pointerType === 'touch';
          let armed = !touch;
          let started = false;
          const hold = touch
            ? setTimeout(() => {
                armed = true;
                navigator.vibrate?.(10);
              }, HOLD_MS)
            : null;
          // Once the hold has armed a drag, a finger moving must not scroll the page instead.
          const still = (touchEvent: TouchEvent) => {
            if (armed) touchEvent.preventDefault();
          };
          if (touch) document.addEventListener('touchmove', still, { passive: false });
          const cleanup = () => {
            if (hold) clearTimeout(hold);
            document.removeEventListener('touchmove', still);
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
            track(begin(task, depth, startX, startY, source), moved.clientX, moved.clientY);
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
            {onto && (
              <Box
                data-testid="drop-onto"
                aria-hidden
                sx={{
                  position: 'fixed',
                  top: onto.top,
                  left: onto.left,
                  width: onto.width,
                  height: onto.height,
                  border: 2,
                  borderColor: 'primary.main',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  zIndex: (theme) => theme.zIndex.tooltip,
                }}
              />
            )}
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
              // The card itself rides up and down with the finger, where it was grabbed.
              <Paper
                aria-hidden
                data-testid="drag-card"
                elevation={8}
                sx={{
                  position: 'fixed',
                  top: pointer.y - active.row.grab,
                  left: active.row.left,
                  width: active.row.width,
                  minHeight: active.row.height,
                  px: 2,
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 2,
                  border: 1,
                  borderColor: 'primary.main',
                  opacity: 0.95,
                  pointerEvents: 'none',
                  zIndex: (theme) => theme.zIndex.tooltip,
                }}
              >
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
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
