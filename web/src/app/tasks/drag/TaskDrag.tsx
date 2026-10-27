// Dragging tasks in a list (spec: PL-014). Rows stay where they are while dragging (no layout
// shifts): the task and its subtasks dim, a line shows where it will land, indented to the depth
// it will take ("kicked over" under its new parent), and a small label follows the pointer.
// Drop zones and rows are found through data attributes, so rows need no registering:
// `data-drag-zone` on the list's rows (with `data-list`), `data-drag-row`
// and `data-depth` on each row, `data-drop-list` on sidebar lists that take a dropped task.

import { Box, Paper, Typography } from '@mui/material';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { getEntity } from '../../../core/collections.ts';
import { projectDrop, type Drop, type DragRow } from '../../../core/taskDrag.ts';
import { canNestUnder, descendants, moveTask, placeBetween } from '../../../core/tasks.ts';
import { dropIntoGroup, leavingPinned, type GroupTarget } from '../../../core/groupDrop.ts';
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

type Landing =
  | (Drop & { listId: Id; onto?: Id })
  | { group: GroupTarget }
  /** A new place within its own group: between these two (null: the group's start or end). */
  | { reorder: { after: Id | null; before: Id | null } };

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

/**
 * The zone under a height on screen (even one that takes no drops: then nothing lands), else the
 * nearest one that takes drops.
 */
function zoneAt(root: Element, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let distance = Infinity;
  for (const zone of root.querySelectorAll<HTMLElement>('[data-drag-zone]')) {
    const box = zone.getBoundingClientRect();
    const away = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
    if (away === 0) return zone;
    // Rows there drag out, nothing drops in.
    if (zone.dataset.dropKind === 'none') continue;
    if (away < distance) {
      distance = away;
      best = zone;
    }
  }
  return best;
}

/** The nearest ancestor that scrolls up and down, or null for the window. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let at = element?.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return null;
}

/** Near the top or bottom edge, the page scrolls this far a frame at most, faster nearer. */
const EDGE_PX = 64;
const SCROLL_STEP = 18;

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
  // A group the task would go into (its whole box outlined).
  const [groupBox, setGroupBox] = useState<DOMRect | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const drop = useRef<Landing | null>(null);
  const reordered = useRef(onReorder);
  useEffect(() => {
    reordered.current = onReorder;
  });
  const hoverList = useRef<HTMLElement | null>(null);
  const swallowClick = useRef(false);
  /**
   * The click a drop or a hold may send is not a tap on the task; but a phone often sends none,
   * so the next real tap must not be eaten: only right after.
   */
  const swallowSoon = useCallback(() => {
    swallowClick.current = true;
    setTimeout(() => {
      swallowClick.current = false;
    }, 350);
  }, []);
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
    lastPoint.current = { x, y };
    const target = document.elementFromPoint?.(x, y)?.closest<HTMLElement>('[data-drop-list]');
    setHover(target ?? null);
    const nowhere = () => {
      setLine(null);
      setOnto(null);
      setGroupBox(null);
      drop.current = null;
    };
    if (target || !root.current) return nowhere();
    const zone = zoneAt(root.current, y);
    // Over a group that takes nothing (Overdue, Pinned): letting go here changes nothing.
    if (!zone || zone.dataset.dropKind === 'none') return nowhere();
    const rows = zoneRows(zone, current.hidden);
    const group = groupOf(zone);
    if (group) {
      // A group: the task takes its value, so the whole group lights up (no place within it).
      const same =
        current.from?.kind === group.kind &&
        current.from.value === group.value &&
        current.from.until === group.until;
      if (same) {
        // Its own group: a new place in it, among its top rows (R-FB-75). Pins keep pin order.
        if (group.kind === 'pin' || current.depth !== 0) return nowhere();
        const top = rows.filter((row) => row.depth === 0);
        const index = top.filter((row) => row.box.top + row.box.height / 2 < y).length;
        setOnto(null);
        setGroupBox(null);
        drop.current = {
          reorder: { after: top[index - 1]?.id ?? null, before: top[index]?.id ?? null },
        };
        const zoneBox = zone.getBoundingClientRect();
        const lineTop =
          index < top.length
            ? top[index]!.box.top
            : top.length > 0
              ? top[top.length - 1]!.box.bottom
              : zoneBox.top + 2;
        const left = zoneBox.left + 8;
        setLine({ top: lineTop, left, width: Math.max(40, zoneBox.right - left - 8) });
        return;
      }
      setOnto(null);
      setLine(null);
      drop.current = { group };
      setGroupBox(zone.getBoundingClientRect());
      return;
    }
    setGroupBox(null);
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

  const ended = useRef<Active | null>(null);
  const finish = useCallback(
    (current: Active, commit: boolean) => {
      // A finger ends a drag twice (pointerup, then touchend): once is enough.
      if (ended.current === current) return;
      ended.current = current;
      const listTarget = hoverList.current?.dataset.dropList;
      setHover(null);
      setActive(null);
      setLine(null);
      setOnto(null);
      setGroupBox(null);
      setPointer(null);
      lastPoint.current = null;
      swallowSoon();
      const landing = drop.current;
      drop.current = null;
      if (!commit) return;
      if (listTarget) {
        const list = getEntity(latest.current, 'lists', listTarget);
        apply(
          (ctx, ws) =>
            moveTask(ctx, leavingPinned(ctx, ws, current.id, current.from), current.id, {
              listId: listTarget,
              parentId: null,
            }),
          t('undo.movedTo', { list: list ? listName(list, latest.current) : '' }),
        );
      } else if (landing && 'reorder' in landing) {
        const { after, before } = landing.reorder;
        apply((ctx, ws) => placeBetween(ctx, ws, current.id, after, before), t('undo.moved'));
      } else if (landing && 'group' in landing) {
        apply(
          (ctx, ws) =>
            dropIntoGroup(
              ctx,
              landing.group.kind === 'pin' ? ws : leavingPinned(ctx, ws, current.id, current.from),
              current.id,
              landing.group,
              current.from,
              localTimeZone(),
            ),
          t('undo.moved'),
        );
      } else if (landing?.onto) {
        const parent = getEntity(latest.current, 'tasks', landing.onto);
        apply(
          (ctx, ws) =>
            moveTask(
              ctx,
              leavingPinned(ctx, ws, current.id, current.from),
              current.id,
              landing.target,
            ),
          t('undo.nested', { title: parent?.title || t('task.untitled') }),
        );
      } else if (landing) {
        apply(
          (ctx, ws) =>
            moveTask(
              ctx,
              leavingPinned(ctx, ws, current.id, current.from),
              current.id,
              landing.target,
            ),
          t('undo.moved'),
        );
        reordered.current?.();
      }
    },
    [apply, swallowSoon],
  );

  // While dragging, the whole window follows the pointer; Escape calls it off. Set up as the
  // drag starts (a layout effect after a synchronous render): no move in between is lost.
  useLayoutEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => {
      event.preventDefault();
      track(active, event.clientX, event.clientY);
    };
    const up = () => finish(active, true);
    // Phones may hand a held finger over to the browser (a pointercancel) and go on with touch
    // events only: follow those too, so the drag carries on.
    const cancelled = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') finish(active, false);
    };
    const touchMove = (event: TouchEvent) => {
      event.preventDefault();
      const finger = event.touches[0];
      if (finger) track(active, finger.clientX, finger.clientY);
    };
    const touchEnd = () => finish(active, true);
    const touchCancel = () => finish(active, false);
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(active, false);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', key, true);
    // A finger dragging a task moves the task, not the page.
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', touchEnd);
    document.addEventListener('touchcancel', touchCancel);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    // Near the top or bottom, the page scrolls on, so tasks off screen can be reached.
    const scroller = scrollParent(root.current);
    let frame = requestAnimationFrame(function edge() {
      const point = lastPoint.current;
      if (point) {
        const box = scroller
          ? scroller.getBoundingClientRect()
          : { top: 0, bottom: window.innerHeight };
        const fromTop = point.y - box.top;
        const fromBottom = box.bottom - point.y;
        const by =
          fromTop < EDGE_PX
            ? -Math.ceil(((EDGE_PX - fromTop) / EDGE_PX) * SCROLL_STEP)
            : fromBottom < EDGE_PX
              ? Math.ceil(((EDGE_PX - fromBottom) / EDGE_PX) * SCROLL_STEP)
              : 0;
        if (by !== 0) {
          if (scroller) scroller.scrollBy(0, by);
          else window.scrollBy(0, by);
          track(active, point.x, point.y);
        }
      }
      frame = requestAnimationFrame(edge);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchend', touchEnd);
      document.removeEventListener('touchcancel', touchCancel);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [active, track, finish]);

  const begin = useCallback((task: Task, depth: number, x: number, y: number, source: Element) => {
    const hidden = new Set<Id>([
      task.id,
      ...descendants(latest.current, task.id).map((each) => each.id),
    ]);
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
    flushSync(() => setActive(current));
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
          // Only a hold on the checkbox opens the menu; a hold on the rest of the row drags.
          const fromCheckbox = (event.target as Element).closest('[data-row-checkbox]') !== null;
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
            document.removeEventListener('touchmove', touchMove);
            document.removeEventListener('touchend', up);
            document.removeEventListener('touchcancel', cleanup);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
          };
          const step = (x: number, y: number) => {
            const far = Math.hypot(x - startX, y - startY) >= START_PX;
            if (!far) return;
            // A finger moving before the hold is a scroll, not a drag.
            if (!armed) {
              cleanup();
              return;
            }
            started = true;
            cleanup();
            track(begin(task, depth, startX, startY, source), x, y);
          };
          const move = (moved: PointerEvent) => step(moved.clientX, moved.clientY);
          // Touch events as well: once the hold has armed a drag, a finger moving must not
          // scroll the page, and they go on where a phone cancels the pointer.
          const touchMove = (touchEvent: TouchEvent) => {
            if (armed) touchEvent.preventDefault();
            const finger = touchEvent.touches[0];
            if (finger) step(finger.clientX, finger.clientY);
          };
          const up = () => {
            cleanup();
            // A held finger let go without moving: on the checkbox, the task menu; elsewhere
            // nothing (and not a tap that opens the task).
            if (touch && armed && !started) {
              swallowSoon();
              if (fromCheckbox) onMenu({ top: startY, left: startX });
            }
          };
          // A phone may cancel a held finger's pointer: its touch events carry on.
          const cancel = () => {
            if (!(touch && armed)) cleanup();
          };
          if (touch) {
            document.addEventListener('touchmove', touchMove, { passive: false });
            document.addEventListener('touchend', up);
            document.addEventListener('touchcancel', cleanup);
          }
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
    [active, begin, track, swallowSoon],
  );

  return (
    <DragContext.Provider value={api}>
      <Box ref={root}>{children}</Box>
      {active &&
        createPortal(
          <>
            {groupBox && (
              <Box
                data-testid="drop-group"
                aria-hidden
                sx={{
                  position: 'fixed',
                  top: groupBox.top - 2,
                  left: groupBox.left - 2,
                  width: groupBox.width + 4,
                  height: Math.max(36, groupBox.height + 4),
                  border: 2,
                  borderStyle: 'dashed',
                  borderColor: 'primary.main',
                  borderRadius: 2,
                  bgcolor: (theme) => `${theme.palette.primary.main}14`,
                  pointerEvents: 'none',
                  zIndex: (theme) => theme.zIndex.tooltip,
                }}
              />
            )}
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
