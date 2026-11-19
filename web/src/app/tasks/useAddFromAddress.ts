import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { NativeShell } from '../../ports/nativeShell.ts';
import { nativeShell } from '../native/shell.ts';
import { fillAddTask, focusAddTask } from './focusAddTask.ts';

/** The shell api that hands over text from outside the app (takeAddText). */
export const ADD_TEXT_API = 13;

/** How long to wait for the page's add-task field to appear (a page still loading). */
const WAIT_MS = 3000;
const EVERY_MS = 50;

/**
 * `?add=1` on a page focuses its add-task field, with the keyboard up in the Android app, then
 * leaves the address: the app's "Add task" shortcut and quick-add widget open `/today?add=1`. Text
 * handed to the app from outside (shared, selected or spoken; shell api 13) goes into the field.
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
      // In the Android app, the keyboard too, as a tap on the field would, and any text waiting.
      const shell = nativeShell();
      if (focused) void shell?.showKeyboard?.();
      if (focused && shell) void fillFromShell(shell);
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

/** Text waiting in the shell (shell api 13), into the add field. */
async function fillFromShell(shell: NativeShell): Promise<void> {
  if (!shell.takeAddText) return;
  const api = await shell.info().then(
    (info) => info.api,
    () => 0,
  );
  if (api < ADD_TEXT_API) return;
  const text = await shell.takeAddText().catch(() => null);
  if (text) fillAddTask(text);
}
