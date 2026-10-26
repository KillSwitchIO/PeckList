import { useMemo, useSyncExternalStore } from 'react';

// What a swipe on a task row does (spec: R-FB-54), like TickTick's swipe settings: the buttons
// each side shows on a short swipe, in order, and what a full swipe does. Kept on this device,
// since swiping is a touch screen's.

export const SWIPE_ACTIONS = ['complete', 'date', 'move', 'pin', 'wontDo', 'delete'] as const;
export type SwipeAction = (typeof SWIPE_ACTIONS)[number];

export interface SwipeSide {
  /** Shown on a short swipe, from the edge the row leaves inward */
  buttons: SwipeAction[];
  /** Done on a full swipe; null: a full swipe only shows the buttons */
  full: SwipeAction | null;
}

export interface SwipePrefs {
  /** Swiping toward the right (the buttons show at the row's left) */
  right: SwipeSide;
  /** Swiping toward the left (the buttons show at the row's right) */
  left: SwipeSide;
}

export const MAX_SWIPE_BUTTONS = 3;

/**
 * Out of the box: a swipe right shows Complete and Pin, and a full one completes (Ben, 2026-10-26,
 * R-FB-86); a full swipe left picks the date (2026-10-25).
 */
export const DEFAULT_SWIPES: SwipePrefs = {
  right: { buttons: ['complete', 'pin'], full: 'complete' },
  left: { buttons: ['date', 'move', 'delete'], full: 'date' },
};

const KEY = 'punchlist.swipes';
const listeners = new Set<() => void>();
let memory: string | null = null;

const isAction = (value: unknown): value is SwipeAction =>
  SWIPE_ACTIONS.includes(value as SwipeAction);

function side(raw: unknown, fallback: SwipeSide): SwipeSide {
  if (!raw || typeof raw !== 'object') return fallback;
  const { buttons, full } = raw as { buttons?: unknown; full?: unknown };
  const list = Array.isArray(buttons) ? [...new Set(buttons.filter(isAction))] : fallback.buttons;
  return {
    buttons: list.slice(0, MAX_SWIPE_BUTTONS),
    full: full === null ? null : isAction(full) ? full : fallback.full,
  };
}

/** Saved choices, with anything missing or unknown taken from the defaults. */
export function parseSwipePrefs(raw: string | null): SwipePrefs {
  if (!raw) return DEFAULT_SWIPES;
  try {
    const saved = JSON.parse(raw) as Partial<Record<'right' | 'left', unknown>>;
    return {
      right: side(saved.right, DEFAULT_SWIPES.right),
      left: side(saved.left, DEFAULT_SWIPES.left),
    };
  } catch {
    return DEFAULT_SWIPES;
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setSwipePrefs(next: SwipePrefs | null): void {
  const raw = next ? JSON.stringify(next) : null;
  try {
    if (raw) localStorage.setItem(KEY, raw);
    else localStorage.removeItem(KEY);
  } catch {
    memory = raw;
  }
  for (const listener of listeners) listener();
}

export function useSwipePrefs(): SwipePrefs {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parseSwipePrefs(raw), [raw]);
}
