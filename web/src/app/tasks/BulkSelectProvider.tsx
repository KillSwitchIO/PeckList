import { useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { Id } from '../../core/types.ts';
import { BulkSelectContext, type BulkSelection } from './bulkSelect.ts';

/** Holds what is picked; going to another page ends picking. */
export function BulkSelectProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<Id>>(new Set());
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
    }),
    [selecting, picked],
  );
  return <BulkSelectContext.Provider value={value}>{children}</BulkSelectContext.Provider>;
}
