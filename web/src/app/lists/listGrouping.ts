import { useState } from 'react';

export type ListGrouping = 'date' | 'section';

const KEY = 'punchlist.listGrouping';

// How each list is grouped is a per-browser view choice for now. It moves into the view's
// filter settings with saved filters (PL-015), so it syncs.
function load(): Record<string, ListGrouping> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, ListGrouping>) : {};
  } catch {
    return {};
  }
}

/** A list's grouping: by date unless it has sections, then by section, until the user picks. */
export function useListGrouping(
  listId: string,
  hasSections: boolean,
): [ListGrouping, (next: ListGrouping) => void] {
  const [picked, setPicked] = useState<ListGrouping | undefined>(() => load()[listId]);
  const set = (next: ListGrouping) => {
    setPicked(next);
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...load(), [listId]: next }));
    } catch {
      // storage unavailable; keep the in-memory choice only
    }
  };
  return [picked ?? (hasSections ? 'section' : 'date'), set];
}
