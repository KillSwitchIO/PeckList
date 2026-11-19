import { getEntity } from '../../core/collections.ts';
import { describePrincipal } from '../../core/sharing.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import type { NotificationItem } from './notificationsContext.ts';

/** What a notification says, with the names as this device knows them (spec: PL-061). */
export function notificationSentence(workspace: WorkspaceFile, item: NotificationItem): string {
  const actor = item.actorId ? describePrincipal(workspace, `user:${item.actorId}`).name : '';
  const task = item.taskId ? getEntity(workspace, 'tasks', item.taskId) : undefined;
  const list = item.listId ? getEntity(workspace, 'lists', item.listId) : undefined;
  const taskName = task ? task.title || t('task.untitled') : t('notifications.aTask');
  const listLabel = list ? listName(list, workspace) : t('notifications.aList');
  switch (item.kind) {
    case 'assigned':
      return t('notifications.assigned', { actor, task: taskName });
    case 'groupAssigned':
      return t('notifications.groupAssigned', { actor, task: taskName });
    case 'claimed':
      return t('notifications.claimed', { actor, task: taskName });
    case 'commented':
      return t('notifications.commented', { actor, task: taskName });
    case 'commentEdited':
      return t('notifications.commentEdited', { actor, task: taskName });
    case 'shared':
      return t('notifications.shared', { actor, list: listLabel });
    case 'mentioned':
      return t('notifications.mentioned', { actor, task: taskName });
    case 'reminder':
      return t('notifications.reminder', { task: taskName });
  }
}

/** The task an acting button names, when it has one. */
const task = (item: NotificationItem) => (item.taskId ? { taskId: item.taskId } : {});

/** Where a notification leads, as the server's pushes word it: the task (at its comment), or the list. */
export function notificationUrl(item: NotificationItem): string {
  if (!item.taskId) return `/lists/${item.listId ?? ''}`;
  return item.commentId
    ? `/today?task=${item.taskId}&comment=${item.commentId}`
    : `/today?task=${item.taskId}`;
}

/**
 * A notification's buttons, left to right, the same as on the server's pushes: Reply and a thumbs
 * up on a comment (R-FB-106), Open task and Call dibs on a group's task (R-FB-107), Open task on
 * an assignment or a dibs call, Open list on a share. A thumbs up or dibs names its task: the
 * press hands it over (the service worker's one-time name, or the Android app), never the url.
 */
export function notificationActions(
  item: NotificationItem,
): { action: string; title: string; url: string; taskId?: string }[] {
  const url = notificationUrl(item);
  switch (item.kind) {
    case 'commented':
    case 'commentEdited':
    case 'mentioned':
      return item.commentId
        ? [
            { action: 'reply', title: t('notifications.reply'), url },
            { action: 'like', title: '👍', url, ...task(item) },
          ]
        : [];
    case 'groupAssigned':
      return [
        { action: 'open', title: t('notifications.openTask'), url },
        { action: 'dibs', title: t('notifications.callDibs'), url, ...task(item) },
      ];
    case 'assigned':
    case 'claimed':
      return [{ action: 'open', title: t('notifications.openTask'), url }];
    case 'shared':
      return [{ action: 'open', title: t('notifications.openList'), url }];
    case 'reminder':
      return [];
  }
}
