import { Box } from '@mui/material';
import { subtaskTree } from '../../core/queries.ts';
import type { Task } from '../../core/types.ts';
import { useCollapsedSet, withoutCollapsed } from '../hooks/useCollapsedSet.ts';
import { useWorkspace } from '../store/hooks.ts';
import { TaskRow } from './TaskRow.tsx';

interface TreeRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
}

/**
 * Tasks with their open subtasks indented underneath (list views). Parents get a chevron to
 * hide or show their subtasks; what is collapsed is remembered in this browser.
 */
export function TaskTree({ tasks }: { tasks: Task[] }) {
  const workspace = useWorkspace();
  const { collapsed, toggle } = useCollapsedSet('punchlist.collapsedTasks');
  const rows: TreeRow[] = tasks.flatMap((task) => {
    const below = subtaskTree(workspace, task.id, { openOnly: true });
    return [
      { task, depth: 0, hasChildren: below.length > 0 },
      ...below.map((node) => ({ ...node, depth: node.depth + 1 })),
    ];
  });
  const visible = withoutCollapsed(
    rows,
    (row) => row.task.id,
    (row) => (row.depth === 0 ? null : row.task.parentId),
    collapsed,
  );

  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {visible.map((row) => (
        <li key={row.task.id}>
          <TaskRow
            task={row.task}
            depth={row.depth}
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
