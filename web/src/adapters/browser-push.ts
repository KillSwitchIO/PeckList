import type { BrowserPush, PushSubscriptionData } from '../ports/notifier.ts';

/** A base64url VAPID key as the bytes `pushManager.subscribe` wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function data(subscription: PushSubscription): PushSubscriptionData {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
}

/** Web Push through the app's service worker. */
export function createBrowserPush(): BrowserPush {
  const registration = () => navigator.serviceWorker.ready;
  return {
    supported: () =>
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window,
    async current() {
      const found = await (await registration()).pushManager.getSubscription();
      return found ? data(found) : null;
    },
    async subscribe(publicKey) {
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission !== 'granted') throw new Error('notifications are not allowed');
      const made = await (
        await registration()
      ).pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      return data(made);
    },
    async unsubscribe() {
      const found = await (await registration()).pushManager.getSubscription();
      if (!found) return null;
      await found.unsubscribe();
      return found.endpoint;
    },
  };
}
