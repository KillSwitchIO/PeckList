// Loaded into the app's service worker (vite.config.ts, workbox importScripts). A click on a
// Punchlist notification focuses an open window on its task, or opens one.
// A constant reminder's Dismiss or Snooze (spec: R-FB-70). Its tag is "<task id>@<first time>".
// An open window does the work (it marks the repeats done here and, for Snooze, adds a reminder
// that syncs); with none open, the server does.
function reminderAction(event) {
  const [taskId, first] = String(event.notification.tag || '').split('@');
  const message = {
    type: 'punchlist-reminder',
    action: event.action,
    taskId,
    first: Number(first),
  };
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    if (windows.length) {
      for (const each of windows) each.postMessage(message);
      return undefined;
    }
    return fetch('/api/reminders/act', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, first: message.first, action: event.action }),
    }).catch(() => undefined);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss' || event.action === 'snooze') {
    event.waitUntil(reminderAction(event));
    return;
  }
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
      ...(payload.sticky
        ? {
            requireInteraction: true,
            renotify: true,
            actions: [
              { action: 'dismiss', title: 'Dismiss' },
              { action: 'snooze', title: 'Snooze 10 min' },
            ],
          }
        : {}),
    }),
  );
});
