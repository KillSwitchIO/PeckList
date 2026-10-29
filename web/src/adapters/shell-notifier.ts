import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type {
  NotificationAction,
  NotificationPermissionState,
  Notifier,
  ScheduledNotification,
} from '../ports/notifier.ts';

/** The first shell api with its own reminders (ShellPlugin.java). */
const REMINDERS_API = 3;
/** The first shell api that shows news (an assignment, a share) with its own buttons, not as a reminder. */
const NEWS_API = 4;

type Display = { display: 'granted' | 'denied' | 'prompt' };

/** `ShellPlugin.java` in mobile/android: the reminder side of it. */
interface ShellReminders {
  info(): Promise<{ api: number }>;
  notificationPermission(): Promise<Display>;
  requestNotificationPermission(): Promise<Display>;
  scheduleReminders(options: { reminders: ShellReminder[] }): Promise<void>;
  showNotification(options: {
    tag: string;
    title: string;
    body: string;
    url: string;
    news?: boolean;
    actions?: { action: string; title: string; url: string }[];
  }): Promise<void>;
  addListener(
    event: 'notificationOpen',
    listener: (event: {
      url?: unknown;
      action?: unknown;
      taskId?: unknown;
      minutes?: unknown;
    }) => void,
  ): Promise<PluginListenerHandle>;
}

interface ShellReminder {
  key: string;
  title: string;
  body: string;
  at: number;
  url: string;
  constant: boolean;
  repeats: boolean;
}

function stateOf({ display }: Display): NotificationPermissionState {
  return display === 'prompt' ? 'default' : display;
}

/** A tap or button press as the shell reports it, if it is one we can act on. */
export function openedOf(event: {
  url?: unknown;
  action?: unknown;
  taskId?: unknown;
  minutes?: unknown;
}): { url: string; action?: NotificationAction } | null {
  if (typeof event.url !== 'string' || !event.url.startsWith('/')) return null;
  if (
    (event.action === 'complete' || event.action === 'snooze') &&
    typeof event.taskId === 'string'
  ) {
    const minutes = typeof event.minutes === 'number' && event.minutes > 0 ? event.minutes : 10;
    return { url: event.url, action: { action: event.action, taskId: event.taskId, minutes } };
  }
  return { url: event.url };
}

/**
 * The Android app's own reminders (ADR-0017, shell api 3): set ahead as exact alarms, shown with
 * Complete and Snooze, which act on the server without opening the app. An older shell has none,
 * so `older` (Capacitor's Local Notifications) takes over there.
 */
export function createShellNotifier(older: () => Notifier | null): Notifier | null {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PunchlistShell')) return null;
  const plugin = registerPlugin<ShellReminders>('PunchlistShell');
  let api = 0;
  const fallback = plugin.info().then(
    (info) => {
      api = info.api;
      return api >= REMINDERS_API ? null : older();
    },
    () => older(),
  );
  // permission() is synchronous: the answer is kept, and refreshed whenever it may have changed.
  let permission: NotificationPermissionState = 'default';
  const refresh = async () => {
    const other = await fallback;
    permission = other
      ? other.permission()
      : stateOf(
          await plugin.notificationPermission().catch((): Display => ({ display: 'denied' })),
        );
    return permission;
  };
  void refresh();

  return {
    permission: () => permission,
    async request() {
      const other = await fallback;
      if (other) return (permission = await other.request());
      if ((await refresh()) !== 'default') return permission;
      permission = stateOf(await plugin.requestNotificationPermission());
      return permission;
    },
    async show(notification) {
      const other = await fallback;
      if (other) return other.show(notification);
      if (notification.kind === 'news') {
        // An older shell would dress it as a reminder, Complete and Snooze included: leave it out.
        if (api < NEWS_API) return;
        await plugin.showNotification({
          tag: notification.tag,
          title: notification.title,
          body: notification.body,
          url: notification.url,
          news: true,
          actions: (notification.actions ?? [])
            .filter((each) => each.url !== undefined)
            .map((each) => ({ action: each.action, title: each.title, url: each.url ?? '/' })),
        });
        return;
      }
      await plugin.showNotification({
        tag: notification.tag,
        title: notification.title,
        body: notification.body,
        url: notification.url,
      });
    },
    async scheduleAhead(notifications: ScheduledNotification[]) {
      const other = await fallback;
      if (other) return other.scheduleAhead?.(notifications);
      await plugin.scheduleReminders({
        reminders: notifications.map((each) => ({
          key: each.tag,
          title: each.title,
          body: each.body,
          at: each.at,
          url: each.url,
          constant: each.sticky === true,
          repeats: each.repeats === true,
        })),
      });
    },
    onOpen(handler) {
      let stop: (() => void) | null = null;
      let stopped = false;
      void fallback.then((other) => {
        if (stopped) return;
        if (other) {
          stop = other.onOpen?.((url) => handler(url)) ?? null;
          return;
        }
        const listening = plugin.addListener('notificationOpen', (event) => {
          const opened = openedOf(event);
          if (opened) handler(opened.url, opened.action);
        });
        stop = () => void listening.then((handle) => handle.remove());
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
}
