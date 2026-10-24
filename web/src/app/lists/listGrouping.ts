import { useState } from 'react';
import type { ListGrouping, ListSort } from '../../core/listView.ts';

export type { ListGrouping, ListSort } from '../../core/listView.ts';

interface ListViewChoice {
  group?: ListGrouping;
  sort?: ListSort;
  /** Picked again: the other way round */
  groupReversed?: boolean;
  sortReversed?: boolean;
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
          groupReversed?: boolean;
          sortReversed?: boolean;
        };
        const group =
          choice.group === 'section' ? 'none' : (choice.group as ListGrouping | undefined);
        const kept: ListViewChoice = {};
        if (group) kept.group = group;
        if (choice.sort) kept.sort = choice.sort;
        if (choice.groupReversed) kept.groupReversed = true;
        if (choice.sortReversed) kept.sortReversed = true;
        return [id, kept];
      }),
    );
  } catch {
    return {};
  }
}

export interface ListViewSettings {
  grouping: ListGrouping;
  sort: ListSort;
  /** The groups the other way round (the grouping picked twice) */
  groupReversed: boolean;
  /** The sort the other way round (the sort picked twice) */
  sortReversed: boolean;
  /** Picks a grouping; the one already picked turns it around. */
  setGrouping: (next: ListGrouping) => void;
  /** Picks a sort; the one already picked turns it around (not the own order). */
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
      const kept =
        next.group === undefined &&
        next.sort === undefined &&
        !next.groupReversed &&
        !next.sortReversed
          ? []
          : [[id, next]];
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...others, ...kept])));
    } catch {
      // storage unavailable; keep the in-memory choice only
    }
  };
  const grouping = picked.group ?? 'date';
  const sort = picked.sort ?? 'manual';
  const groupReversed = grouping !== 'none' && (picked.groupReversed ?? false);
  const sortReversed = sort !== 'manual' && (picked.sortReversed ?? false);
  return {
    grouping,
    sort,
    groupReversed,
    sortReversed,
    setGrouping: (group) =>
      save({
        ...picked,
        group,
        groupReversed: group === grouping && group !== 'none' ? !groupReversed : false,
      }),
    setSort: (next) =>
      save({
        ...picked,
        sort: next,
        sortReversed: next === sort && next !== 'manual' ? !sortReversed : false,
      }),
    isDefault: grouping === 'date' && sort === 'manual' && !groupReversed,
    reset: () => save({}),
  };
}
