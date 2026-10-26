import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type PermissionStatus } from '@capacitor/local-notifications';
import type {
  AppNotification,
  NotificationPermissionState,
  Notifier,
  ScheduledNotification,
} from '../ports/notifier.ts';

/** The Android channel reminders go to (its name is what Settings > Notifications shows). */
export const CHANNEL = 'reminders';

/** A notification id: the plugin wants a 31-bit integer, we have string keys. */
export function idOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  // Never 0, and leave room above for show()'s ids.
  return (Math.abs(hash) % 1_000_000_000) + 1;
}

function stateOf(status: PermissionStatus): NotificationPermissionState {
  if (status.display === 'granted') return 'granted';
  if (status.display === 'denied') return 'denied';
  return 'default';
}

/**
 * Android's own notifications (spec: PL-061, ADR-0017), through Capacitor's Local Notifications:
 * reminders are handed to the system ahead of time, so they fire with exact alarms even with the
 * app closed; a tap opens the task. Null when the shell has no such plugin (an older app).
 */
export function createCapacitorNotifier(channelName: string): Notifier | null {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('LocalNotifications')) {
    return null;
  }
  // permission() is synchronous: the answer is kept, and refreshed whenever it may have changed.
  let permission: NotificationPermissionState = 'default';
  const refresh = async () => {
    permission = stateOf(await LocalNotifications.checkPermissions());
    return permission;
  };
  void refresh();
  void LocalNotifications.createChannel({ id: CHANNEL, name: channelName, importance: 4 });

  const toNative = (notification: AppNotification, id: number, at?: number) => ({
    id,
    title: notification.title,
    body: notification.body,
    channelId: CHANNEL,
    extra: { url: notification.url, tag: notification.tag },
    ...(at === undefined ? {} : { schedule: { at: new Date(at), allowWhileIdle: true } }),
  });

  // The reminders last handed over: kept, so granting permission later schedules them at once.
  let wanted: ScheduledNotification[] = [];
  const handOver = async () => {
    const byId = new Map(wanted.map((each) => [idOf(each.tag), each]));
    const { notifications: pending } = await LocalNotifications.getPending();
    const stale = pending.filter((each) => !byId.has(each.id));
    if (stale.length > 0) {
      await LocalNotifications.cancel({ notifications: stale.map(({ id }) => ({ id })) });
    }
    // Scheduling an id again replaces it, so a moved reminder simply moves.
    if (byId.size > 0) {
      await LocalNotifications.schedule({
        notifications: [...byId].map(([id, each]) => toNative(each, id, each.at)),
      });
    }
  };

  return {
    permission: () => permission,
    async request() {
      if ((await refresh()) !== 'default') return permission;
      permission = stateOf(await LocalNotifications.requestPermissions());
      if (permission === 'granted') await handOver();
      return permission;
    },
    async show(notification) {
      if ((await refresh()) !== 'granted') return;
      await LocalNotifications.schedule({
        notifications: [toNative(notification, idOf(`now:${notification.tag}`))],
      });
    },
    async scheduleAhead(notifications: ScheduledNotification[]) {
      wanted = notifications;
      if ((await refresh()) === 'granted') await handOver();
    },
    onOpen(handler) {
      const listening = LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (action) => {
          const url = (action.notification.extra as { url?: unknown } | undefined)?.url;
          if (typeof url === 'string' && url.startsWith('/')) handler(url);
        },
      );
      return () => void listening.then((handle) => handle.remove());
    },
  };
}
