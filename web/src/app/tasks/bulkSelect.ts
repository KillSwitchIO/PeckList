import { createContext, useContext, useEffect } from 'react';
import type { Id } from '../../core/types.ts';

// Picking many tasks at once (spec: R-FB-55), like TickTick: Select in a view's menu turns every
// row's box into a circle to pick it, each section gets a circle that picks all it holds, and the
// bottom bar becomes the actions for what is picked.

export interface BulkSelection {
  selecting: boolean;
  picked: ReadonlySet<Id>;
  /** Start picking (with these already picked) */
  start: (ids?: Id[]) => void;
  stop: () => void;
  toggle: (ids: Id[], on: boolean) => void;
}

export const BulkSelectContext = createContext<BulkSelection | null>(null);

export const useBulkSelect = () => useContext(BulkSelectContext);

/** The rows a section holds, so its circle can pick them all. */
export interface SectionRows {
  add: (id: Id) => void;
  remove: (id: Id) => void;
}

export const SectionRowsContext = createContext<SectionRows | null>(null);

/** A row says which section it sits in (each section above it, for nested ones). */
export function useInSection(id: Id, active: boolean) {
  const section = useContext(SectionRowsContext);
  useEffect(() => {
    if (!section || !active) return;
    section.add(id);
    return () => section.remove(id);
  }, [section, id, active]);
}
