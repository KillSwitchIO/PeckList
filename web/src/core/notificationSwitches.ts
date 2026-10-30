import type { NotificationSwitches, Settings } from './types.ts';

/** A notification's kind as the server names it (NotificationKind) or 'reminder'. */
export type NotificationKind =
  | 'assigned'
  | 'groupAssigned'
  | 'claimed'
  | 'shared'
  | 'mentioned'
  | 'commented'
  | 'commentEdited'
  | 'reminder';

/** The switch (settings.notifications, schema 17, PL-115) a kind of notification is behind. */
export function switchOf(kind: NotificationKind): keyof NotificationSwitches {
  switch (kind) {
    case 'reminder':
      return 'reminders';
    case 'shared':
      return 'shares';
    case 'commented':
    case 'commentEdited':
    case 'mentioned':
      return 'comments';
    default:
      return 'assignments';
  }
}

/** Whether a kind of notification is to be shown; absent settings or an absent switch mean yes. */
export function notificationAllowed(
  settings: Settings | undefined,
  kind: NotificationKind,
): boolean {
  return settings?.notifications?.[switchOf(kind)] !== false;
}

/** Whether notifications vibrate (where the device lets the page say); absent: yes. */
export function vibrates(settings: Settings | undefined): boolean {
  return settings?.notifications?.vibrate !== false;
}
