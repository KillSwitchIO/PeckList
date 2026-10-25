// Loaded into the app's service worker (vite.config.ts, workbox importScripts). A click on a
// Punchlist notification focuses an open window on its task, or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/today', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((each) => new URL(each.url).origin === self.location.origin);
      if (open) return open.focus().then((focused) => (focused || open).navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});

// A push from the server (a reminder, an assignment, a mention): show it. The same tag as the
// app's own reminder replaces it rather than showing twice.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Punchlist', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Punchlist', {
      body: payload.body || '',
      tag: payload.tag,
      data: { url: payload.url || '/today' },
      icon: '/icon.svg',
      badge: '/icon.svg',
      // A constant reminder stays until dismissed and buzzes again on each repeat.
      ...(payload.sticky ? { requireInteraction: true, renotify: true } : {}),
    }),
  );
});
