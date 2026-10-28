// When the empty view's mark (our logo flipping round to a check) plays (R-FB-152): on arriving
// at a page, and again only when the view empties while it is open (the last task completed).
// Not on every redraw: opening a task's panel (which changes the address's query), a sync or a
// change elsewhere showed it again and again. An arrival is a change of the address's path.

import { useEffect, useId, useState } from 'react';
import { useLocation } from 'react-router';

let lastPath: string | null = null;
let arrival = 0;

/** The current arrival, counting a new one when the path changed. The shell calls it as it draws. */
export function noteArrival(pathname: string): string {
  if (pathname !== lastPath) {
    lastPath = pathname;
    arrival += 1;
  }
  return `${arrival}`;
}

/** Arrivals whose mark has played. */
const played = new Set<string>();
/** Arrivals where the view held something again after its mark played. */
const refilled = new Set<string>();
/** What each mark decided (a mount may be rendered twice in development). */
const decided = new Map<string, boolean>();

/** A view says whether it shows nothing: something in it after the mark lets the mark play again. */
export function useNoteEmpty(empty: boolean): void {
  const at = noteArrival(useLocation().pathname);
  useEffect(() => {
    if (!empty && played.has(at)) refilled.add(at);
  }, [empty, at]);
}

/** Whether this mark animates, or shows its check at once. */
export function useMarkPlays(): boolean {
  const at = noteArrival(useLocation().pathname);
  const id = useId();
  const [plays] = useState(() => {
    const before = decided.get(id);
    if (before !== undefined) return before;
    const now = !played.has(at) || refilled.has(at);
    played.add(at);
    refilled.delete(at);
    decided.set(id, now);
    return now;
  });
  return plays;
}
