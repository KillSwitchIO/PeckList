// Tasks as an export writes them: list by list, each in its own order, subtasks under their task.

import { visibleLists } from '../lists.ts';
import { siblings } from '../tasks.ts';
import type { List, Task, WorkspaceFile } from '../types.ts';

export interface Walked {
  list: List;
  task: Task;
  /** 0 for a top-level task */
  depth: number;
}

/** Every live task of the lists (all, or those named), depth first in display order. */
export function walkTasks(
  workspace: WorkspaceFile,
  listIds?: readonly string[] | null,
  keep: (task: Task) => boolean = () => true,
): Walked[] {
  const wanted = listIds ? new Set(listIds) : null;
  const out: Walked[] = [];
  for (const list of visibleLists(workspace, true)) {
    if (wanted && !wanted.has(list.id)) continue;
    const visit = (parentId: string | null, depth: number) => {
      for (const task of siblings(workspace, list.id, parentId)) {
        if (!keep(task)) continue;
        out.push({ list, task, depth });
        visit(task.id, depth + 1);
      }
    };
    visit(null, 0);
  }
  return out;
}

/** A list's name as another app should see it: the Mess Drawer is their Inbox. */
export const exportName = (list: List) => (list.isInbox ? 'Inbox' : list.name);
