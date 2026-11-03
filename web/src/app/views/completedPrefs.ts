import { useSyncExternalStore } from 'react';

// Whether the Completed group shows under lists and views (R-FB-159). Kept on this device, like
// the swipe and view choices: one phone may want a clean list while the desk keeps the record.
// The Closed view and search still show closed tasks either way.

const KEY = 'pecklist.hideCompleted';
const listeners = new Set<() => void>();
let fallback: string | null = null;

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function setHideCompleted(hide: boolean): void {
  try {
    if (hide) localStorage.setItem(KEY, 'true');
    else localStorage.removeItem(KEY);
  } catch {
    fallback = hide ? 'true' : null;
  }
  for (const listener of listeners) listener();
}

/** Whether the Completed group is hidden on this device. */
export function useHideCompleted(): boolean {
  return useSyncExternalStore(subscribe, read, () => null) === 'true';
}
