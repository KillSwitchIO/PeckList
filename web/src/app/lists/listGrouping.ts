import { useState } from 'react';
import type { ListGrouping, ListSort } from '../../core/listView.ts';

export type { ListGrouping, ListSort } from '../../core/listView.ts';

interface ListViewChoice {
  group?: ListGrouping;
  sort?: ListSort;
}

const KEY = 'punchlist.listGrouping';

// How each list is grouped and sorted is a per-browser view choice for now. It moves into the
// view's filter settings with saved filters (PL-015), so it syncs.
function load(): Record<string, ListViewChoice> {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, ListViewChoice | ListGrouping>) : {};
    // Older choices were just the grouping.
    return Object.fromEntries(
      Object.entries(stored).map(([id, value]) => [
        id,
        typeof value === 'string' ? { group: value } : value,
      ]),
    );
  } catch {
    return {};
  }
}

export interface ListViewSettings {
  grouping: ListGrouping;
  sort: ListSort;
  setGrouping: (next: ListGrouping) => void;
  setSort: (next: ListSort) => void;
}

/**
 * A list's grouping and sort. Grouping: by date unless it has sections, then by section, until the
 * person picks. Sort: the list's own order.
 */
export function useListView(listId: string, hasSections: boolean): ListViewSettings {
  const [picked, setPicked] = useState<ListViewChoice>(() => load()[listId] ?? {});
  const save = (next: ListViewChoice) => {
    setPicked(next);
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...load(), [listId]: next }));
    } catch {
      // storage unavailable; keep the in-memory choice only
    }
  };
  return {
    grouping: picked.group ?? (hasSections ? 'section' : 'date'),
    sort: picked.sort ?? 'manual',
    setGrouping: (group) => save({ ...picked, group }),
    setSort: (sort) => save({ ...picked, sort }),
  };
}
