import { useRef, type PointerEvent } from 'react';
import { ownEvent } from './ownEvent.ts';

const DELAY_MS = 500;
const SLOP_PX = 8;

/**
 * The rest of a touch whose long press fired is the menu's: its later moves stop at the window, so
 * nothing behind follows the finger (a bottom sheet's swipe, from a document listener, did). Until
 * that touch ends, or the next one starts if its end never comes.
 */
function keepRestOfTouch() {
  const stop = (event: TouchEvent) => event.stopPropagation();
  const done = () => {
    window.removeEventListener('touchmove', stop, true);
    window.removeEventListener('touchend', done, true);
    window.removeEventListener('touchcancel', done, true);
    window.removeEventListener('touchstart', done, true);
  };
  window.addEventListener('touchmove', stop, { capture: true, passive: true });
  window.addEventListener('touchend', done, true);
  window.addEventListener('touchcancel', done, true);
  window.addEventListener('touchstart', done, true);
}

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
      // A hold in a popup the element opened (a row's date picker) is not a hold on the element.
      if (event.pointerType !== 'touch' || !ownEvent(event)) return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      const point = { top: event.clientY, left: event.clientX };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        keepRestOfTouch();
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
