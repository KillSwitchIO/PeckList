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
    const stored = raw ? (JSON.parse(raw) as Record<string, ListViewChoice | string>) : {};
    // Older choices were just the grouping; grouping by section became the list's own order.
    return Object.fromEntries(
      Object.entries(stored).map(([id, value]) => {
        const choice = (typeof value === 'string' ? { group: value } : value) as {
          group?: string;
          sort?: ListSort;
        };
        const group =
          choice.group === 'section' ? 'none' : (choice.group as ListGrouping | undefined);
        return [id, { ...(group ? { group } : {}), ...(choice.sort ? { sort: choice.sort } : {}) }];
      }),
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

/** A list's grouping and sort: by date and the list's own order until the person picks. */
export function useListView(listId: string): ListViewSettings {
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
    grouping: picked.group ?? 'date',
    sort: picked.sort ?? 'manual',
    setGrouping: (group) => save({ ...picked, group }),
    setSort: (sort) => save({ ...picked, sort }),
  };
}
