import { describe, expect, it } from 'vitest';
import type { NotificationItem } from './notificationsContext.ts';
import { notificationActions, notificationUrl } from './notificationText.ts';

describe('a notification shown while the app is on screen', () => {
  it('Reply puts the cursor in the comment box; the tap and the thumbs up only open (R-FB-106)', () => {
    const item: NotificationItem = {
      id: 'N1',
      kind: 'commented',
      at: 0,
      actorId: 'U2',
      taskId: 'T1',
      listId: null,
      commentId: 'C1',
      read: false,
      local: false,
    };
    expect(notificationUrl(item)).toBe('/today?task=T1&comment=C1');
    // As the server's pushes word them (NotificationText.ActionsOf).
    expect(notificationActions(item).map((each) => [each.action, each.url])).toEqual([
      ['reply', '/today?task=T1&comment=C1&reply=1'],
      ['like', '/today?task=T1&comment=C1'],
    ]);
  });
});
