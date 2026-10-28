import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

/** Set on the history entry that opening a task added, so closing it can go back over it. */
const OPENED = 'punchlistOpenedTask';

/**
 * The open task lives in the URL (`?task=<id>`) so it survives reloads and back navigation;
 * `&full=1` opens it in the large full-screen view (the quick add bar's expand button).
 *
 * Opening a task from the list adds one history entry; switching to another task replaces it, and
 * closing goes back over it. So Back (the browser's, or Android's) closes the task, and closing
 * with x or Escape leaves no entry behind that a later Back would reopen.
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
  const navigate = useNavigate();
  const location = useLocation();
  const selectedId = params.get('task');
  const full = params.get('full') === '1';
  const openedHere = (location.state as Record<string, unknown> | null)?.[OPENED] === true;
  const open = useCallback(
    (id: string, options?: { full?: boolean }) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('task', id);
          if (options?.full) next.set('full', '1');
          else next.delete('full');
          return next;
        },
        selectedId === null
          ? { state: { [OPENED]: true } }
          : { replace: true, state: openedHere ? { [OPENED]: true } : null },
      ),
    [setParams, selectedId, openedHere],
  );
  // Closing again before the address has changed (two Escapes, a dialog and the page both
  // closing) must not go back a second time, past the page.
  const closing = useRef<string | null>(null);
  useEffect(() => {
    closing.current = null;
  }, [selectedId]);
  const close = useCallback(() => {
    if (selectedId !== null && closing.current === selectedId) return;
    closing.current = selectedId;
    if (openedHere) {
      void navigate(-1);
      return;
    }
    // Opened by an address (a link, a reload): nothing of ours to go back over.
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('task');
        next.delete('full');
        return next;
      },
      { replace: true },
    );
  }, [setParams, navigate, openedHere, selectedId]);
  const leaveFull = useCallback(
    () =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('full');
          return next;
        },
        { replace: true, state: openedHere ? { [OPENED]: true } : null },
      ),
    [setParams, openedHere],
  );
  return { selectedId, full, open, close, leaveFull };
}
