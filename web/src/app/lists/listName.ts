import { getEntity, isLive } from '../../core/collections.ts';
import { listMembersOf } from '../../core/sharing.ts';
import type { List, WorkspaceFile } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';

/** The groups a list is shared with, by name. */
export function sharedGroupNames(workspace: WorkspaceFile, listId: string): string[] {
  return listMembersOf(workspace, listId)
    .filter((member) => member.principal.startsWith('group:'))
    .map((member) => getEntity(workspace, 'groups', member.principal.slice(6)))
    .filter((group) => group !== undefined && isLive(group))
    .map((group) => group!.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The name shown for a list. The default list is always the Mess Drawer. A list shared with a
 * group shows as "{list} - {group}" for everyone (spec: PL-042), so it never looks like a member's
 * own list of the same name; the stored name never changes, so unsharing brings the plain name back.
 */
export function listName(
  list: Pick<List, 'id' | 'name' | 'isInbox'>,
  workspace: WorkspaceFile,
): string {
  if (list.isInbox) return t('nav.inbox');
  const groups = sharedGroupNames(workspace, list.id);
  return groups.length > 0 ? `${list.name} - ${groups.join(', ')}` : list.name;
}
