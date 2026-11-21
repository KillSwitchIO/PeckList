import { useEffect, useState } from 'react';
import type { ListGrouping, ListSort, ViewChoice } from '../../core/listView.ts';

export type { ListGrouping, ListSort } from '../../core/listView.ts';

const KEY = 'pecklist.listGrouping';

// How a list or a built-in view is grouped and sorted is a per-browser choice for now (a list's
// would need a schema change to sync). A saved filter's is stored with the filter and syncs
// (PL-015): see `SyncedViewChoice`.
function load(): Record<string, ViewChoice> {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, ViewChoice | string>) : {};
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
        const kept: ViewChoice = {};
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

/** Keeps `id`'s choice in this browser, or forgets it (`null`, or the defaults). */
function store(id: string, next: ViewChoice | null) {
  try {
    const others = Object.entries(load()).filter(([key]) => key !== id);
    const kept =
      next === null ||
      (next.group === undefined &&
        next.sort === undefined &&
        !next.groupReversed &&
        !next.sortReversed)
        ? []
        : [[id, next]];
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...others, ...kept])));
  } catch {
    // storage unavailable; keep the in-memory choice only
  }
}

/** A view whose choice is stored with it and syncs (a saved filter), instead of in this browser. */
export interface SyncedViewChoice {
  /** The stored choice; `{}` until someone picks. */
  choice: ViewChoice;
  save: (next: ViewChoice) => void;
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
 * date and the own order until the person picks. With `synced` the choice is the view's own stored
 * one; a choice this browser kept from before still shows until the next pick moves it there.
 */
export function useListView(id: string, synced?: SyncedViewChoice): ListViewSettings {
  // Kept with its id: a page that moves to another list or filter reads that one's choice.
  const [held, setHeld] = useState<{ id: string; choice: ViewChoice }>(() => ({
    id,
    choice: load()[id] ?? {},
  }));
  const local = held.id === id ? held.choice : (load()[id] ?? {});
  const stored = synced && Object.keys(synced.choice).length > 0 ? synced.choice : null;
  const picked = stored ?? local;
  // Once the view has a stored choice, this browser's old one is done with: otherwise it would
  // come back when someone restores the defaults on another device.
  const hasStored = stored !== null;
  if (hasStored && held.id === id && Object.keys(held.choice).length > 0) {
    setHeld({ id, choice: {} });
  }
  useEffect(() => {
    if (hasStored && load()[id]) store(id, null);
  }, [hasStored, id]);
  const save = (next: ViewChoice) => {
    if (synced) {
      synced.save(next);
      setHeld({ id, choice: {} });
      store(id, null);
      return;
    }
    setHeld({ id, choice: next });
    store(id, next);
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
