import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** The open task lives in the URL (`?task=<id>`) so it survives reloads and back navigation. */
export function useTaskSelection(): {
  selectedId: string | null;
  open: (id: string) => void;
  close: () => void;
} {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('task');
  const open = useCallback(
    (id: string) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set('task', id);
        return next;
      }),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('task');
        return next;
      }),
    [setParams],
  );
  return { selectedId, open, close };
}
