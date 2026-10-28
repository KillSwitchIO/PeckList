import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { snap } from '../../core/calendarLayout.ts';

/** Where a dragged task would land: a day (all day) or a time on a day. */
export interface DropTarget {
  day: string;
  /** Minutes into the day; null for all day */
  minutes: number | null;
}

/** What is being dragged: a task on the calendar, or one from the Unscheduled panel. */
export interface DragPayload {
  taskId: string;
  title: string;
  /** For a timed task, minutes from its start to where it was grabbed (it keeps that offset) */
  grabMinutes?: number;
}

/** A day column of times: `data-cal-slots="YYYY-MM-DD"`, its hour height in `data-hour-height`. */
export function targetAt(x: number, y: number, grabMinutes = 0): DropTarget | null {
  const found = document.elementFromPoint?.(x, y);
  if (!found) return null;
  const column = found.closest<HTMLElement>('[data-cal-slots]');
  if (column) {
    const rect = column.getBoundingClientRect();
    const hour = Number(column.dataset.hourHeight) || 48;
    const minutes = snap(((y - rect.top) / hour) * 60 - grabMinutes);
    return { day: column.dataset.calSlots!, minutes: Math.max(0, Math.min(1425, minutes)) };
  }
  const day = found.closest<HTMLElement>('[data-cal-day]');
  return day ? { day: day.dataset.calDay!, minutes: null } : null;
}

const MOVE_PX = 6;
const HOLD_MS = 350;

/**
 * Dragging tasks onto days and times (spec: PL-093). A mouse drags as soon as it moves a few
 * pixels. A finger holds the task for a moment first, so a swipe anywhere, tasks included,
 * scrolls the calendar (R-FB-99). While dragging, `ghost` follows the pointer with where it would
 * land; letting go there calls `onDrop` (a task held and let go without moving stays put). A click
 * right after a drag is swallowed, so dropping does not also open the task.
 */
export function useCalendarDrag(
  onDrop: (payload: DragPayload, target: DropTarget) => void,
  onStart?: () => void,
) {
  const [ghost, setGhost] = useState<{
    x: number;
    y: number;
    /** Dragged by a finger: the label goes above it, where the thumb does not cover it. */
    touch: boolean;
    taskId: string;
    title: string;
    target: DropTarget | null;
  } | null>(null);
  const drop = useRef(onDrop);
  const start = useRef(onStart);
  useEffect(() => {
    drop.current = onDrop;
    start.current = onStart;
  });
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const begin = (event: PointerEvent<HTMLElement>, payload: DragPayload) => {
    if (event.button !== 0) return;
    cleanup.current?.();
    const touch = event.pointerType === 'touch';
    const origin = { x: event.clientX, y: event.clientY };
    const id = event.pointerId;
    let dragging = false;
    // Moved since it was picked up: only then does letting go move the task.
    let travelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const show = (x: number, y: number) =>
      setGhost({
        x,
        y,
        touch,
        taskId: payload.taskId,
        title: payload.title,
        target: targetAt(x, y, payload.grabMinutes),
      });
    const lift = (x: number, y: number) => {
      dragging = true;
      start.current?.();
      navigator.vibrate?.(10);
      show(x, y);
    };
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== id) return;
      const far = Math.hypot(next.clientX - origin.x, next.clientY - origin.y) > MOVE_PX;
      if (!dragging) {
        if (touch && far)
          finish(); // a swipe: let the page scroll
        else if (!touch && far) {
          travelled = true;
          lift(next.clientX, next.clientY);
        }
        return;
      }
      if (far) travelled = true;
      show(next.clientX, next.clientY);
    };
    const up = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== id) return;
      if (dragging) {
        const target = travelled ? targetAt(next.clientX, next.clientY, payload.grabMinutes) : null;
        if (target) drop.current(payload, target);
        // The click that follows a drop is not a click on the task.
        const swallow = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      finish();
    };
    // Once a finger holds a task, moving it must not scroll the page.
    const hold = (touchEvent: TouchEvent) => {
      if (dragging) touchEvent.preventDefault();
    };
    const finish = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', finish);
      document.removeEventListener('touchmove', hold);
      cleanup.current = null;
      setGhost(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', finish);
    document.addEventListener('touchmove', hold, { passive: false });
    if (touch) timer = setTimeout(() => lift(origin.x, origin.y), HOLD_MS);
    cleanup.current = finish;
  };

  /** Stop following the pointer (a long hold turned into something else). */
  const cancel = () => cleanup.current?.();
  return { begin, ghost, cancel };
}
