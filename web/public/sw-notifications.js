// Loaded into the app's service worker (vite.config.ts, workbox importScripts). A click on a
// PeckList notification focuses an open window on its task, or opens one.
// A constant reminder's Dismiss or Snooze (spec: R-FB-70). Its tag is "<task id>@<first time>".
// An open window does the work (it marks the repeats done here and tells the server, which keeps
// a snooze for this person alone; with no server, Snooze adds a reminder to the task); with none
// open, the server does. `tellServer`: the server is told even with a window open (a window about
// to go to the task may not live long enough to tell it; a dismiss told twice is one). Returns
// when the windows have it (`posted`) and when the server has been told (`told`), so a click can
// open the task without waiting on the server (a browser lets a click open a window for about 10 s).
function reminderAction(event, action = event.action, tellServer = false) {
  const [taskId, first] = String(event.notification.tag || '').split('@');
  const message = {
    type: 'pecklist-reminder',
    action,
    taskId,
    first: Number(first),
  };
  const windows = self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const posted = windows.then((open) => {
    for (const each of open) each.postMessage(message);
    return open.length;
  });
  const told = posted.then((count) => {
    if (count && !tellServer) return undefined;
    return fetch('/api/reminders/act', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, first: message.first, action }),
    }).catch(() => undefined);
  });
  return { posted, told };
}

// When the reminder a notification is for first came: its tag is "<task id>@<first time>". A
// reminder's Complete carries it, so a notice left up never completes a later occurrence.
function firstOf(notification) {
  const first = Number(String(notification.tag || '').split('@')[1]);
  return Number.isFinite(first) && first > 0 ? first : undefined;
}

// A click on a constant reminder where its Dismiss is not shown. Its buttons are Complete, Snooze
// and Dismiss, left to right: Chrome has room for two, and Firefox on a computer shows none (nor
// does it keep the notice up). Opening it is the Dismiss as well there, or it would come back every
// 5 minutes with no way to stop it short of completing the task (QA's drill, 2026-11-20).
const CONSTANT_BUTTONS = 3;

function dismissedByClick(event) {
  const room = self.Notification && self.Notification.maxActions;
  return !event.action && event.notification.data?.sticky === true && !(room >= CONSTANT_BUTTONS);
}

// A path on this server, or Today: a push (or a button in it) never opens another site (audit
// W2), as the Android app's notifications already do. "//host" and "/\host" are other sites too.
function hereOnly(url) {
  return typeof url === 'string' && /^\/(?![/\\])/.test(url) ? url : '/today';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss' || event.action === 'snooze') {
    event.waitUntil(reminderAction(event).told);
    return;
  }
  // A button with a place of its own (Reply, thumbs up, Open task, Call dibs: R-FB-106, R-FB-107).
  const pressed = (event.notification.data?.actions || []).find(
    (each) => each.action === event.action,
  );
  const where = new URL(
    hereOnly(pressed?.url || event.notification.data?.url),
    self.location.origin,
  );
  // The windows hear a click-dismiss before the task opens; the server's answer is not waited on.
  const dismissing = dismissedByClick(event) ? reminderAction(event, 'dismiss', true) : null;
  const opening = (dismissing ? dismissing.posted : Promise.resolve())
    .then(() => handOver(pressed, where, firstOf(event.notification)))
    .then((url) =>
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
        const open = windows.find((each) => new URL(each.url).origin === self.location.origin);
        if (open) return open.focus().then((focused) => (focused || open).navigate(url));
        return self.clients.openWindow(url);
      }),
    );
  event.waitUntil(Promise.all([opening, dismissing ? dismissing.told : undefined]));
});

// What the page does for a button that acts (thumbs up, Call dibs, a reminder's Complete) waits here, under a one-time
// random name the address carries (?act=), never in the address itself: a link from another site
// could carry like=1, but it cannot write this origin's caches (security review 2026-11-19). The
// page deletes the entry before acting on its own task, and only if it is under two minutes old
// (NotificationLinks).
const ACTIONS = 'pecklist-actions';

function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function handOver(pressed, where, first) {
  const acts =
    pressed &&
    (pressed.action === 'like' || pressed.action === 'dibs' || pressed.action === 'complete');
  if (!acts || typeof pressed.taskId !== 'string' || !pressed.taskId) {
    return Promise.resolve(where.href);
  }
  const name = nonce();
  const entry = JSON.stringify({
    kind: pressed.action,
    taskId: pressed.taskId,
    at: Date.now(),
    // A reminder's Complete: the occurrence it is for (NotificationLinks checks it).
    ...(pressed.action === 'complete' && first ? { first } : {}),
  });
  return caches
    .open(ACTIONS)
    .then((cache) =>
      cache.put(
        `/act/${name}`,
        new Response(entry, { headers: { 'Content-Type': 'application/json' } }),
      ),
    )
    .then(
      () => {
        where.searchParams.set('act', name);
        return where.href;
      },
      // No caches here: the button just opens its task.
      () => where.href,
    );
}

// A push from the server (a reminder, an assignment, a mention): show it. The same tag as the
// app's own reminder replaces it rather than showing twice.
self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'PeckList', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'PeckList', {
      body: payload.body || '',
      tag: payload.tag,
      data: {
        url: payload.url || '/today',
        actions: payload.actions || [],
        // Where the browser shows no buttons, a click is the Dismiss as well (dismissedByClick).
        ...(payload.sticky ? { sticky: true } : {}),
      },
      icon: '/icon.svg',
      badge: '/icon.svg',
      // Its buttons, left to right: Reply and thumbs up on a comment, Open task and Call dibs on
      // a group's task, Complete on a reminder.
      ...(payload.actions?.length
        ? { actions: payload.actions.map(({ action, title }) => ({ action, title })) }
        : {}),
      // A constant reminder stays until dismissed and buzzes again on each repeat. Its own buttons
      // (Complete) come first, then Snooze and Dismiss, as the app's own (dismissedByClick).
      ...(payload.sticky
        ? {
            requireInteraction: true,
            renotify: true,
            actions: [
              ...(payload.actions || []).map(({ action, title }) => ({ action, title })),
              { action: 'snooze', title: 'Snooze 10 min' },
              { action: 'dismiss', title: 'Dismiss' },
            ],
          }
        : {}),
    }),
  );
});
