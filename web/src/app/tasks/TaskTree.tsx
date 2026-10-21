import { Box } from '@mui/material';
import { subtaskTree } from '../../core/queries.ts';
import type { Task, WorkspaceFile } from '../../core/types.ts';
import { getEntity } from '../../core/collections.ts';
import { useCollapsedSet, withoutCollapsed } from '../hooks/useCollapsedSet.ts';
import { useWorkspace } from '../store/hooks.ts';
import { TaskRow } from './TaskRow.tsx';

interface TreeRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
  /** Nearest shown ancestor; null for a root row */
  parentId: string | null;
}

/**
 * Whether `task` will show nested under an ancestor in this view: walking up, an ancestor that
 * is itself in the view takes it in; an ancestor with a place of its own elsewhere (say, another
 * date) breaks the chain, and the task stands on its own.
 */
function nestsUnderAncestor(
  workspace: WorkspaceFile,
  task: Task,
  inView: Set<string>,
  ownPlace: (task: Task) => boolean,
): boolean {
  let parentId = task.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    if (inView.has(parentId)) return true;
    const parent = getEntity(workspace, 'tasks', parentId);
    if (!parent || parent.deletedAt !== null || ownPlace(parent)) return false;
    parentId = parent.parentId;
  }
  return false;
}

/**
 * Tasks with their open subtasks indented underneath. Parents get a chevron to hide or show
 * their subtasks (remembered in this browser).
 *
 * `tasks` are the view's own tasks (a list's top-level tasks, a day's tasks, a tag's tasks).
 * A subtask follows its parent unless `ownPlace` says it belongs somewhere else (a subtask with
 * its own date in date views): then it nests only when it is in this view too, and otherwise
 * appears in its own spot, where the row names its parent.
 */
export function TaskTree({
  tasks,
  showList = false,
  ownPlace = () => false,
}: {
  tasks: Task[];
  showList?: boolean;
  ownPlace?: (task: Task) => boolean;
}) {
  const workspace = useWorkspace();
  const { collapsed, toggle } = useCollapsedSet('punchlist.collapsedTasks');
  const inView = new Set(tasks.map((task) => task.id));
  const follows = (task: Task) => inView.has(task.id) || !ownPlace(task);

  const rows: TreeRow[] = tasks
    .filter((task) => !nestsUnderAncestor(workspace, task, inView, ownPlace))
    .flatMap((root) => {
      // Drop subtasks that live elsewhere, with everything under them.
      const dropped = new Set<string>();
      const below = subtaskTree(workspace, root.id, { openOnly: true }).filter((node) => {
        if ((node.task.parentId && dropped.has(node.task.parentId)) || !follows(node.task)) {
          dropped.add(node.task.id);
          return false;
        }
        return true;
      });
      const hasKids = (id: string) => below.some((node) => node.task.parentId === id);
      return [
        { task: root, depth: 0, hasChildren: hasKids(root.id), parentId: null },
        ...below.map((node) => ({
          task: node.task,
          depth: node.depth + 1,
          hasChildren: hasKids(node.task.id),
          parentId: node.task.parentId,
        })),
      ];
    });
  const visible = withoutCollapsed(
    rows,
    (row) => row.task.id,
    (row) => row.parentId,
    collapsed,
  );

  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {visible.map((row) => (
        <li key={row.task.id}>
          <TaskRow
            task={row.task}
            depth={row.depth}
            // Nested rows sit under their parent already; only roots say where they live.
            showList={showList && row.depth === 0}
            {...(row.hasChildren
              ? {
                  expander: {
                    open: !collapsed.has(row.task.id),
                    onToggle: () => toggle(row.task.id),
                  },
                }
              : {})}
          />
        </li>
      ))}
    </Box>
  );
}
