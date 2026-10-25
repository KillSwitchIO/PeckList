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
    async show({ title, body, tag, url, sticky = false, actions }: AppNotification) {
      if (!supported() || Notification.permission !== 'granted') return;
      const options = {
        body,
        tag,
        data: { url },
        icon: '/icon.svg',
        badge: '/icon.svg',
        ...(sticky ? { requireInteraction: true, renotify: true } : {}),
        ...(actions?.length ? { actions } : {}),
      };
      const registration = await navigator.serviceWorker?.getRegistration?.();
      if (registration) {
        await registration.showNotification(title, options);
        return;
      }
      const shown = new Notification(title, options);
      shown.onclick = () => {
        window.focus();
        window.location.assign(url);
        shown.close();
      };
    },
  };
}
