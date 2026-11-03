import { useMemo, useSyncExternalStore } from 'react';
import type { Id } from '../../core/types.ts';
import type { ListLayout } from '../views/SortGroupButton.tsx';

// Each list's view, List or Timeline (spec: R-FB-56), and how the timeline is laid out: kept on
// this device, like the other view choices, and remembered per list.

const LAYOUTS = 'pecklist.listLayouts';
const TIMELINE = 'pecklist.timeline';

export interface TimelinePrefs {
  /** Fit bars that do not overlap onto shared rows, rather than one row per task */
  fit: boolean;
  /** Pixels per day */
  dayWidth: number;
}

/** Zoom steps, pixels per day: out to months at a glance, in to roomy days (R-FB-155). */
export const DAY_WIDTHS = [12, 20, 32, 48, 72, 104, 144] as const;
const DEFAULT_TIMELINE: TimelinePrefs = { fit: false, dayWidth: 48 };

const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

/** The list's view, as last picked for it. */
export function useListLayout(listId: Id): [ListLayout, (next: ListLayout) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(LAYOUTS),
    () => null,
  );
  const layouts = useMemo(() => parse<Record<string, ListLayout>>(raw, {}), [raw]);
  const layout = layouts[listId] === 'timeline' ? 'timeline' : 'list';
  return [
    layout,
    (next) => {
      const all = Object.entries(parse<Record<string, ListLayout>>(read(LAYOUTS), {})).filter(
        ([id]) => id !== listId,
      );
      if (next !== 'list') all.push([listId, next]);
      write(LAYOUTS, JSON.stringify(Object.fromEntries(all)));
    },
  ];
}

export function useTimelinePrefs(): [TimelinePrefs, (patch: Partial<TimelinePrefs>) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(TIMELINE),
    () => null,
  );
  const prefs = useMemo(() => parse(raw, DEFAULT_TIMELINE), [raw]);
  return [prefs, (patch) => write(TIMELINE, JSON.stringify({ ...prefs, ...patch }))];
}
