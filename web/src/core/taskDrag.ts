// Where a dragged task lands (spec: PL-014). Views pass the rows they show; this works out the
// parent, section and position from the slot the pointer is over and how far right it was
// pulled, so the drop always matches the indented preview drawn while dragging.

import { requireEntity } from './collections.ts';
import type { OpContext } from './ops.ts';
import {
  indentTask,
  MAX_SUBTASK_DEPTH,
  moveTask,
  outdentTask,
  siblings,
  subtreeHeight,
  type MoveTarget,
} from './tasks.ts';
import type { Id, WorkspaceFile } from './types.ts';

/** A row as a view shows it: depth 0 is top level. */
export interface DragRow {
  id: Id;
  depth: number;
}

export interface Drop {
  /** Depth the task will sit at (what the preview indents to) */
  depth: number;
  target: MoveTarget;
}

/**
 * The drop for `activeId` into `rows` (one section's visible rows, without the dragged task and
 * its subtasks) at slot `index` (0 is above the first row), wanting `depth`. The depth is kept
 * between what the neighbours allow: at most one deeper than the row above (and within the
 * nesting limit), at least as deep as the row below, so the rows below keep their parents.
 */
export function projectDrop(
  workspace: WorkspaceFile,
  activeId: Id,
  listId: Id,
  sectionId: Id | null,
  rows: readonly DragRow[],
  index: number,
  depth: number,
): Drop {
  const above = index > 0 ? rows[index - 1] : undefined;
  const below = rows[index];
  const deepest = Math.min(
    above ? above.depth + 1 : 0,
    MAX_SUBTASK_DEPTH - subtreeHeight(workspace, activeId),
  );
  const shallowest = Math.min(below ? below.depth : 0, deepest);
  const settled = Math.max(shallowest, Math.min(deepest, Math.max(0, depth)));

  // The parent: the nearest row above that sits one level up.
  let parentId: Id | null = null;
  if (settled > 0) {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (rows[i]!.depth === settled - 1) {
        parentId = rows[i]!.id;
        break;
      }
    }
  }
  // The sibling just above at the same depth, if any (a deeper row above is a nephew).
  let afterId: Id | null = null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.depth < settled) break;
    if (row.depth === settled) {
      afterId = row.id;
      break;
    }
  }
  const target: MoveTarget = { listId, sectionId, parentId };
  // Right after its sibling above; else before the row below if that is a sibling (the rows
  // below are never deeper than the drop); else it is the only one here: the end.
  if (afterId) target.afterId = afterId;
  else if (below && below.depth === settled) target.beforeId = below.id;
  return { depth: settled, target };
}

type Move = (ctx: OpContext, workspace: WorkspaceFile, id: Id) => WorkspaceFile;

/** One step up or down among its siblings (no change at either end). */
function step(offset: -1 | 1): Move {
  return (ctx, workspace, id) => {
    const task = requireEntity(workspace, 'tasks', id);
    const peers = siblings(workspace, task.listId, task.sectionId, task.parentId);
    const index = peers.findIndex((peer) => peer.id === id);
    const other = peers[index + offset];
    if (!other) return workspace;
    const place = offset < 0 ? { beforeId: other.id } : { afterId: other.id };
    return moveTask(ctx, workspace, id, {
      listId: task.listId,
      sectionId: task.sectionId,
      parentId: task.parentId,
      ...place,
    });
  };
}

/** The keyboard counterpart of dragging (with Alt): arrows move, nest and outdent. */
export function keyboardMove(key: string): Move | null {
  switch (key) {
    case 'ArrowUp':
      return step(-1);
    case 'ArrowDown':
      return step(1);
    case 'ArrowRight':
      return indentTask;
    case 'ArrowLeft':
      return outdentTask;
    default:
      return null;
  }
}
