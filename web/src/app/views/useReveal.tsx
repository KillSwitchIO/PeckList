// Long lists of closed tasks render as they scroll into reach (R-FB-94): the first rows at once,
// more while the end of what is drawn is still screens away, so scrolling never meets an edge.
// A spacer holds the place of the rows not drawn yet, so the scroll bar is the whole list's from
// the start. 4,279 closed rows drawn at once took 4 s to show and half a second to leave.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** One row's height before any is measured, for the spacer standing in for the rest. */
const ROW_HEIGHT = 44;

/** The nearest ancestor that scrolls (the page's own scroll area), or null for the window. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * How many of `total` rows to draw now, and the spacer to put after them. Without
 * IntersectionObserver (old browsers, tests) everything is drawn.
 */
export function useReveal(
  total: number,
  first = 60,
  step = 150,
): { shown: number; spacer: ReactNode } {
  const [shown, setShown] = useState(first);
  // What a drawn row takes on average (group headings included), so the spacer is as tall as the
  // rest will be and the scroll range ends where the list does (R-FB-96).
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  const sentinel = useRef<HTMLDivElement>(null);
  const observable = typeof IntersectionObserver !== 'undefined';
  useLayoutEffect(() => {
    const element = sentinel.current;
    const parent = element?.parentElement;
    if (!element || !parent || shown === 0) return;
    const drawn = element.getBoundingClientRect().top - parent.getBoundingClientRect().top;
    const each = drawn / Math.min(shown, total);
    if (each > 8 && Math.abs(each - rowHeight) > 0.5) setRowHeight(each);
  }, [shown, total, rowHeight]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !observable || shown >= total) return;
    // Watching anew after each step also checks at once whether the spacer is still near.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setShown((now) => Math.min(total, now + step));
      },
      { root: scrollParent(element), rootMargin: '0px 0px 3000px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [observable, shown, total, step]);
  if (!observable) return { shown: total, spacer: null };
  const rest = Math.max(0, total - shown);
  return {
    shown: Math.min(shown, total),
    spacer:
      rest > 0 ? (
        <div ref={sentinel} aria-hidden style={{ height: Math.round(rest * rowHeight) }} />
      ) : null,
  };
}
