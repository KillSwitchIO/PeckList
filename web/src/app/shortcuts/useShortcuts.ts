import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { canEditTask } from '../../core/sharing.ts';
import { deleteTask, toggleTaskDone } from '../../core/tasks.ts';
import { popupOpen, typing } from '../hooks/keys.ts';
import { t } from '../i18n/i18n.ts';
import { useWorkspaceStore } from '../store/hooks.ts';
import { focusAddTask } from '../tasks/focusAddTask.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { matchShortcut, type ShortcutAction } from './shortcuts.ts';

/** How long G waits for its second key. */
const SEQUENCE_MS = 1200;

/** Task rows on the page, in order (their open buttons carry `data-task-row`). */
const taskRows = () => [...document.querySelectorAll<HTMLElement>('main [data-task-row]')];

/**
 * The app's keyboard shortcuts (see shortcuts.ts). Returns whether the "?" list is open and a
 * way to close it.
 */
export function useShortcuts(): { helpOpen: boolean; closeHelp: () => void } {
  const navigate = useNavigate();
  const store = useWorkspaceStore();
  const { selectedId, open, close } = useTaskSelection();
  const [helpOpen, setHelpOpen] = useState(false);
  const pending = useRef<{ key: string; at: number } | null>(null);
  // The latest selection for the listener (set in an effect, never during render).
  const selection = useRef({ selectedId, open, close });
  useEffect(() => {
    selection.current = { selectedId, open, close };
  }, [selectedId, open, close]);

  useEffect(() => {
    const run = (action: ShortcutAction): boolean => {
      const { selectedId: current, open: openTask, close: closeTask } = selection.current;
      const state = store.getState();
      const workspace = state.workspace;
      const task = current && workspace ? getEntity(workspace, 'tasks', current) : undefined;
      const editable =
        task !== undefined && isLive(task) && canEditTask(workspace!, state.context().userId, task);
      switch (action.kind) {
        case 'go':
          void navigate(action.path);
          return true;
        case 'search':
          void navigate('/search');
          return true;
        case 'help':
          setHelpOpen(true);
          return true;
        case 'addTask':
          if (!focusAddTask()) {
            void navigate('/inbox');
            setTimeout(focusAddTask, 0);
          }
          return true;
        case 'next':
        case 'previous': {
          const rows = taskRows();
          if (rows.length === 0) return false;
          const at = rows.findIndex((row) => row.dataset.taskRow === current);
          const index =
            at < 0
              ? action.kind === 'next'
                ? 0
                : rows.length - 1
              : Math.min(rows.length - 1, Math.max(0, at + (action.kind === 'next' ? 1 : -1)));
          const row = rows[index]!;
          openTask(row.dataset.taskRow!);
          row.focus();
          row.scrollIntoView?.({ block: 'nearest' });
          return true;
        }
        case 'edit': {
          if (!editable) return false;
          const title = document.querySelector<HTMLInputElement>(
            `[aria-label="${t('task.details')}"] input`,
          );
          title?.focus();
          title?.select();
          return title !== null;
        }
        case 'complete':
          if (!editable) return false;
          state.apply(
            (ctx, ws) => toggleTaskDone(ctx, ws, task.id),
            task.status === 'open' ? t('undo.completed') : t('undo.reopened'),
          );
          return true;
        case 'delete':
          if (!editable) return false;
          state.apply((ctx, ws) => deleteTask(ctx, ws, task.id), t('undo.deleted'));
          closeTask();
          return true;
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (typing() || popupOpen()) return;
      const key = event.key.toLowerCase();
      // Space and Delete act on the open task, except where they belong to a focused control
      // (a button's Space presses it); a task row's own button is fine.
      const focused = document.activeElement;
      if (
        (key === ' ' || key === 'delete') &&
        focused instanceof HTMLElement &&
        focused !== document.body &&
        !focused.hasAttribute('data-task-row')
      ) {
        return;
      }
      const now = Date.now();
      const earlier =
        pending.current && now - pending.current.at < SEQUENCE_MS ? pending.current : null;
      const pressed = earlier ? [earlier.key, key] : [key];
      const found = matchShortcut(pressed);
      if (found === 'pending') {
        pending.current = { key, at: now };
        event.preventDefault();
        return;
      }
      pending.current = null;
      if (!found) return;
      if (run(found.action)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, store]);

  return { helpOpen, closeHelp: () => setHelpOpen(false) };
}
