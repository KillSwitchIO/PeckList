import { createContext, useContext } from 'react';
import { canEditTask } from '../../core/sharing.ts';
import type { Task } from '../../core/types.ts';
import { useStoreState, useWorkspace } from '../store/hooks.ts';

/**
 * Whether the task controls inside are for looking only: a task on a list I can only view
 * (spec: Sharing & Permissions). The server refuses such edits; the app does not offer them.
 */
export const TaskReadOnly = createContext(false);

export function useReadOnly(): boolean {
  return useContext(TaskReadOnly);
}

export function useCanEditTask(task: Task): boolean {
  const workspace = useWorkspace();
  const me = useStoreState((state) => state.context().userId);
  return canEditTask(workspace, me, task);
}
