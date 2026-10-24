import { useRef, type PointerEvent } from 'react';

const DELAY_MS = 500;
const SLOP_PX = 8;

/**
 * Long-press on touch screens, as the touch counterpart of a right-click: hold still for half
 * a second and `onLongPress` gets the point. Moving (scrolling) or lifting early cancels. The
 * click that follows a long-press is swallowed so the row doesn't also open.
 */
export function useLongPress(onLongPress: (point: { top: number; left: number }) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      const point = { top: event.clientY, left: event.clientX };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        onLongPress(point);
      }, DELAY_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > SLOP_PX) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
