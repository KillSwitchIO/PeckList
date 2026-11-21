import { duplicateTasks, toDuplicate } from '../../core/duplicate.ts';
import type { Id, WorkspaceFile } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import type { WorkspaceState } from '../store/workspaceStore.ts';
import { openingCopy } from './detailFocus.ts';

type Apply = WorkspaceState['apply'];

/**
 * Duplicates these tasks (PL-139) as one change to undo. With `open`, a single copy opens with its
 * title selected; several copies open nothing. Returns the copies' ids.
 */
export function duplicate(
  apply: Apply,
  workspace: WorkspaceFile,
  ids: readonly Id[],
  open?: (id: Id) => void,
): Id[] {
  // Counted first: the label is made before the change runs.
  const count = toDuplicate(workspace, ids).length;
  if (count === 0) return [];
  // Set inside the operation: apply runs it once, before it returns, so copies is filled below.
  let copies: Id[] = [];
  apply(
    (ctx, ws) => {
      const made = duplicateTasks(ctx, ws, ids);
      copies = made.ids;
      return made.workspace;
    },
    count === 1 ? t('undo.duplicated') : t('bulk.duplicated', { count }),
  );
  const only = copies.length === 1 ? copies[0] : undefined;
  if (open && only) {
    openingCopy(only);
    open(only);
  }
  return copies;
}
