import { useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { Id } from '../../core/types.ts';
import {
  BulkSelectContext,
  PageRowsContext,
  type BulkSelection,
  type SectionRows,
} from './bulkSelect.ts';

/** Holds what is picked; going to another page ends picking. */
export function BulkSelectProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<Id>>(new Set());
  const [rows, setRows] = useState<ReadonlySet<Id>>(new Set());
  const registry = useMemo<SectionRows>(
    () => ({
      add: (id) => setRows((before) => (before.has(id) ? before : new Set(before).add(id))),
      remove: (id) =>
        setRows((before) => {
          if (!before.has(id)) return before;
          const next = new Set(before);
          next.delete(id);
          return next;
        }),
    }),
    [],
  );
  const [page, setPage] = useState(pathname);
  if (page !== pathname) {
    setPage(pathname);
    if (selecting) {
      setSelecting(false);
      setPicked(new Set());
    }
  }
  const value = useMemo<BulkSelection>(
    () => ({
      selecting,
      picked,
      start: (ids = []) => {
        setSelecting(true);
        setPicked(new Set(ids));
      },
      stop: () => {
        setSelecting(false);
        setPicked(new Set());
      },
      toggle: (ids, on) =>
        setPicked((before) => {
          const next = new Set(before);
          for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      rows,
    }),
    [selecting, picked, rows],
  );
  return (
    <BulkSelectContext.Provider value={value}>
      <PageRowsContext.Provider value={registry}>{children}</PageRowsContext.Provider>
    </BulkSelectContext.Provider>
  );
}
