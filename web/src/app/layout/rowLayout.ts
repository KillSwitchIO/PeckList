// Whether task rows use two lines (title on top, details under it): on phones, and wherever the
// list column is narrow, such as beside the details panel on a laptop (PL-094).
import { createContext, useContext, useEffect, useState } from 'react';

/** Below this list-column width a one-line row starts cutting titles short. */
export const TWO_LINE_BELOW_PX = 720;

export const TwoLineRowsContext = createContext(false);

export const useTwoLineRows = () => useContext(TwoLineRowsContext);

/** True while `element` is narrower than TWO_LINE_BELOW_PX (false where it cannot be measured). */
export function useNarrow(element: HTMLElement | null): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < TWO_LINE_BELOW_PX);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return narrow;
}
