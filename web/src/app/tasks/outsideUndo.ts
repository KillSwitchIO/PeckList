import { useSyncExternalStore } from 'react';

// Undo for a change that lives outside the workspace (hiding a calendar's event, PL-134): the same
// round button as a workspace change, but the change is held here and only made once the button
// goes, so Undo needs nothing from the server. One at a time: a newer change, here or in the
// workspace, makes the held one at once.

export interface OutsideUndoEntry {
  id: number;
  label: string;
}

interface Held extends OutsideUndoEntry {
  undo: () => void;
  commit: () => void;
}

let held: Held | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/** Hold a change with Undo; whatever was held before is made now. */
export function offerOutsideUndo(label: string, undo: () => void, commit: () => void): void {
  const before = held;
  held = { id: nextId++, label, undo, commit };
  before?.commit();
  changed();
}

/** The button went (its time ran out, it was swiped away, or a newer change came): make it. */
export function commitOutsideUndo(): void {
  const before = held;
  held = null;
  before?.commit();
  if (before) changed();
}

/** Undo was pressed: drop the change. */
export function undoOutsideUndo(): void {
  const before = held;
  held = null;
  before?.undo();
  if (before) changed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => held;

/** The change waiting on Undo, if any. */
export function useOutsideUndo(): OutsideUndoEntry | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
