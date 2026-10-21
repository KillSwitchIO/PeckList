import { useRef, useState, type PointerEvent } from 'react';
import type { Id } from '../../core/types.ts';

const HOLD_MS = 500;
const DRAG_PX = 6;

interface Gesture {
  id: string;
  x: number;
  y: number;
  touch: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  dragging: boolean;
  /** The row's section and where it sat when the press began. */
  section: Element | null;
  sectionTop: number;
}

/**
 * Drag to sort rows of one section. `onDrag(id, y)` gets the dragged id and the pointer's height
 * as it moves; `slot(ids, y)` turns that into an index among `ids` (the rows above the pointer).
 * Holding or dragging a row starts editing; right-click does too. While editing a finger drags,
 * before that it scrolls.
 */
export function useSortableRows({
  editing,
  start,
  onDrag,
  onDrop,
}: {
  editing: boolean;
  start: () => void;
  onDrag: (id: Id, y: number) => void;
  /** A drag ended (the pointer let go). */
  onDrop?: (id: Id) => void;
}) {
  const rows = useRef(new Map<string, HTMLElement>());
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);

  const end = () => {
    const current = gesture.current;
    if (current?.dragging) onDrop?.(current.id);
    if (current?.timer) clearTimeout(current.timer);
    gesture.current = null;
    setDragging(null);
  };

  const rowProps = (id: string) => ({
    ref: (element: HTMLElement | null) => {
      if (element) rows.current.set(id, element);
      else rows.current.delete(id);
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const current: Gesture = {
        id,
        x: event.clientX,
        y: event.clientY,
        touch: event.pointerType === 'touch',
        dragging: false,
        section: event.currentTarget.closest('ul'),
        sectionTop: event.currentTarget.closest('ul')?.getBoundingClientRect().top ?? 0,
        timer: setTimeout(() => {
          current.timer = null;
          swallowClick.current = true;
          start();
        }, HOLD_MS),
      };
      gesture.current = current;
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current) return;
      if (!current.dragging) {
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_PX) return;
        if (current.touch && !editing) {
          end();
          return;
        }
        if (current.timer) clearTimeout(current.timer);
        current.timer = null;
        current.dragging = true;
        swallowClick.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        start();
        setDragging(current.id);
      }
      // Starting to edit can move this section (rows appear above it). Measure the pointer
      // against the rows as they were when the press began, so the drop lands where aimed.
      const shift =
        (current.section?.getBoundingClientRect().top ?? current.sectionTop) - current.sectionTop;
      onDrag(current.id, event.clientY + shift);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault();
      start();
    },
  });

  /** Run a row's click, unless it ends a drag or a hold. */
  const click = (action: () => void) => () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    action();
  };

  /** Where the pointer sits among `ids`: how many of their middles are above it. */
  const slot = (ids: readonly string[], y: number) =>
    ids.filter((id) => {
      const box = rows.current.get(id)?.getBoundingClientRect();
      return box !== undefined && box.top + box.height / 2 < y;
    }).length;

  /** A row's box on screen, if it is showing. */
  const box = (id: string) => rows.current.get(id)?.getBoundingClientRect();

  return { rowProps, click, slot, box, dragging };
}
