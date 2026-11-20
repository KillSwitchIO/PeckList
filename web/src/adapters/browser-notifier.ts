import type { AppNotification, Notifier } from '../ports/notifier.ts';

const supported = () => typeof window !== 'undefined' && 'Notification' in window;

/**
 * Notifications through the service worker when there is one (they stay in the system tray and a
 * click opens the app: public/sw-notifications.js), else straight from the page.
 */
export function createBrowserNotifier(): Notifier {
  return {
    permission: () => (supported() ? Notification.permission : 'unsupported'),
    async request() {
      if (!supported()) return 'unsupported';
      if (Notification.permission !== 'default') return Notification.permission;
      return Notification.requestPermission();
    },
    async show({ title, body, tag, url, sticky = false, actions, vibrate }: AppNotification) {
      if (!supported() || Notification.permission !== 'granted') return;
      const plain = {
        body,
        tag,
        // A button with a place of its own: the service worker's click handler reads it here. So
        // does sticky: where the browser shows no buttons, a click is the Dismiss as well.
        data: {
          url,
          ...(actions?.some((each) => each.url) ? { actions } : {}),
          ...(sticky ? { sticky: true } : {}),
        },
        icon: '/icon.svg',
        badge: '/icon.svg',
        ...(sticky ? { requireInteraction: true, renotify: true } : {}),
        // Honored by Android browsers, ignored elsewhere (PL-115).
        ...(vibrate === false ? {} : { vibrate: [250, 150, 250] }),
      };
      const options = actions?.length ? { ...plain, actions } : plain;
      const worker = navigator.serviceWorker;
      const registration = await worker?.getRegistration?.();
      if (registration) {
        // A first visit: the worker is still installing, and showNotification throws "No active
        // registration" until it is active (QA's drill, 2026-11-20, with reminders already due).
        const ready = registration.active ? registration : await worker!.ready;
        await ready.showNotification(title, options);
        return;
      }
      // From the page itself (no worker yet: a first visit, a dev server), without buttons: Chrome
      // throws for actions on a notification no worker shows, and every reminder has one now.
      const shown = new Notification(title, plain);
      shown.onclick = () => {
        window.focus();
        window.location.assign(url);
        shown.close();
      };
    },
  };
}
