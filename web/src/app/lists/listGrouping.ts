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
  /** Whether the grouping and sort are the view's own defaults. */
  isDefault: boolean;
  /** Back to the view's defaults. */
  reset: () => void;
}

/**
 * A list's or a view's grouping and sort, by its id (a list id, or `view:today` and the like): by
 * date and the own order until the person picks.
 */
export function useListView(id: string): ListViewSettings {
  // Kept with its id: a page that moves to another list or filter reads that one's choice.
  const [held, setHeld] = useState<{ id: string; choice: ListViewChoice }>(() => ({
    id,
    choice: load()[id] ?? {},
  }));
  const picked = held.id === id ? held.choice : (load()[id] ?? {});
  const save = (next: ListViewChoice) => {
    setHeld({ id, choice: next });
    try {
      const others = Object.entries(load()).filter(([key]) => key !== id);
      const kept = next.group === undefined && next.sort === undefined ? [] : [[id, next]];
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...others, ...kept])));
    } catch {
      // storage unavailable; keep the in-memory choice only
    }
  };
  const grouping = picked.group ?? 'date';
  const sort = picked.sort ?? 'manual';
  return {
    grouping,
    sort,
    setGrouping: (group) => save({ ...picked, group }),
    setSort: (sort) => save({ ...picked, sort }),
    isDefault: grouping === 'date' && sort === 'manual',
    reset: () => save({}),
  };
}
