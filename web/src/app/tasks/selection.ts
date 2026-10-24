import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * The open task lives in the URL (`?task=<id>`) so it survives reloads and back navigation;
 * `&full=1` opens it in the large full-screen view (the quick add bar's expand button).
 */
export function useTaskSelection(): {
  selectedId: string | null;
  /** Whether the address asks for the full-screen view. */
  full: boolean;
  open: (id: string, options?: { full?: boolean }) => void;
  close: () => void;
  /** Leave the full-screen view the address asked for. */
  leaveFull: () => void;
} {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('task');
  const full = params.get('full') === '1';
  const open = useCallback(
    (id: string, options?: { full?: boolean }) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set('task', id);
        if (options?.full) next.set('full', '1');
        else next.delete('full');
        return next;
      }),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('task');
        next.delete('full');
        return next;
      }),
    [setParams],
  );
  const leaveFull = useCallback(
    () =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('full');
        return next;
      }),
    [setParams],
  );
  return { selectedId, full, open, close, leaveFull };
}
