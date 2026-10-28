import { useRef } from 'react';
import { hatch, type Egg } from './eggs.ts';

/**
 * Holding a control still for a while hatches an egg (R-FB-122: the + button's dog). Its click
 * after a hold is not a click: `swallowed()` says so once.
 */
export function useHoldToHatch(egg: Egg, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hatched = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    handlers: {
      onPointerDown: () => {
        stop();
        hatched.current = false;
        timer.current = setTimeout(() => {
          hatched.current = true;
          hatch(egg);
        }, ms);
      },
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      // A long touch would otherwise open the browser's own menu.
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    },
    swallowed: () => {
      const was = hatched.current;
      hatched.current = false;
      return was;
    },
  };
}
