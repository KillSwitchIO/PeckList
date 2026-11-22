// Helpers for the list and filter row menus (PL-149): see RowMenu.tsx.

import type { MouseEvent } from 'react';

/** Where a row menu opens: a point on the screen. */
export type RowMenuAt = { top: number; left: number };

/** For the row's sx while not editing: the ⋯ shows on hover or focus, over the count. */
export const rowMenuHoverSx = {
  '@media (hover: hover)': {
    '& .row-more': { opacity: 0 },
    '&:hover .row-more, &:focus-within .row-more, & .row-more[aria-expanded="true"]': {
      opacity: 1,
    },
    '&:hover .row-count, &:focus-within .row-count': { visibility: 'hidden' },
  },
} as const;

/** Whether the main pointer can hover (a mouse), as `(hover: hover)` says. */
const canHover = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;

/**
 * A row's right-click: a mouse's opens the menu at the pointer; a finger's (a long press that
 * the browser also reports as a right-click) and any while editing go to `fallback`, which starts
 * editing the sidebar as before. Firefox and older WebViews report a long press as a plain mouse
 * event with no pointer type, so one without it counts as a finger where nothing can hover.
 */
export function rightClickMenu(
  editing: boolean,
  open: (at: RowMenuAt) => void,
  fallback: (event: MouseEvent) => void,
) {
  return (event: MouseEvent) => {
    const pointer = (event.nativeEvent as Partial<PointerEvent>).pointerType;
    const finger = pointer === 'touch' || (!pointer && !canHover());
    if (editing || finger) {
      fallback(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    open({ top: event.clientY, left: event.clientX });
  };
}
