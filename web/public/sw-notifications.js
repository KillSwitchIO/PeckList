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
