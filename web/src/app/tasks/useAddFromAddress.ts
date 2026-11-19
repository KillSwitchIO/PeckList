import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { nativeShell } from '../native/shell.ts';
import { focusAddTask } from './focusAddTask.ts';

/** How long to wait for the page's add-task field to appear (a page still loading). */
const WAIT_MS = 3000;
const EVERY_MS = 50;

/**
 * `?add=1` on a page focuses its add-task field, with the keyboard up in the Android app, then
 * leaves the address: the app's "Add task" shortcut and quick-add widget open `/today?add=1`.
 */
export function useAddFromAddress(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const where = useRef(location);
  useEffect(() => {
    where.current = location;
  });
  const adding = new URLSearchParams(location.search).get('add') === '1';
  useEffect(() => {
    if (!adding) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const focused = focusAddTask();
      if (!focused && Date.now() - started < WAIT_MS) return;
      clearInterval(timer);
      // In the Android app, the keyboard too, as a tap on the field would.
      if (focused) void nativeShell()?.showKeyboard?.();
      const params = new URLSearchParams(where.current.search);
      params.delete('add');
      const rest = params.toString();
      void navigate(
        { pathname: where.current.pathname, search: rest ? `?${rest}` : '' },
        { replace: true },
      );
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [adding, navigate]);
}
