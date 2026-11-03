import { useSyncExternalStore } from 'react';

// Which task groups are folded, by what the group is ("overdue", "completed", "priority:3",
// "tag:<id>"), not by page: folding Overdue in Today folds it in Next 7 days, a list and All too.
// Kept on this device, like the other view choices.

const KEY = 'pecklist.collapsedGroups';
const listeners = new Set<() => void>();
// Used only when storage cannot be read or written (a locked-down browser).
let memory: Record<string, boolean> = {};

function read(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab folding a group folds it here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Folds or unfolds a group everywhere it shows. */
export function setGroupOpen(key: string, open: boolean, defaultOpen: boolean): void {
  // Only what differs from how the group comes is kept.
  const next = Object.fromEntries(Object.entries(read()).filter(([each]) => each !== key));
  if (open !== defaultOpen) next[key] = open;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: folded for this visit only.
    memory = next;
  }
  for (const listener of listeners) listener();
}

/** Whether the group `key` is open: as last left anywhere in the app, else `defaultOpen`. */
export function useGroupOpen(key: string | undefined, defaultOpen: boolean): boolean {
  const stored = useSyncExternalStore(subscribe, () =>
    key === undefined ? undefined : read()[key],
  );
  return stored ?? defaultOpen;
}
