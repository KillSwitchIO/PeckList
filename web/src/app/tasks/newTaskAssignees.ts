import { getEntity } from '../../core/collections.ts';
import { assignsSelf } from '../../core/newTaskDefaults.ts';
import type { WorkspaceFile } from '../../core/types.ts';

/**
 * Who a new task in `listId` is assigned to from the start (spec: PL-088): the person making it,
 * in a shared list on a server with accounts, the way TickTick assigns in shared lists. Private
 * lists have no assignees, so "Assigned to me" keeps meaning tasks someone gave you. Settings > New
 * tasks can turn it off (PL-092).
 */
export function newTaskAssignees(
  workspace: WorkspaceFile,
  listId: string,
  me: string,
  accounts: boolean,
): string[] {
  const shared = getEntity(workspace, 'lists', listId)?.visibility === 'shared';
  return accounts && shared && assignsSelf(workspace) ? [`user:${me}`] : [];
}
