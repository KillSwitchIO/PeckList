// The pages split off the app's first load (R-FB-94).

import { lazy, type ComponentType } from 'react';

/**
 * A page that loads on first visit (R-FB-94): settings, admin, the calendar and the like are a
 * tenth of the app's code, not needed to show the task lists. React's own `lazy`, with `preload`
 * to fetch it ahead (the app does once idle, so pages open offline and without a wait).
 */
function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loading: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () => (loading ??= load().then((component) => ({ default: component })));
  return Object.assign(lazy(preload), { preload });
}

export const CalendarPage = lazyPage(() =>
  import('./calendar/CalendarPage.tsx').then((m) => m.CalendarPage),
);
export const FriendLinkPage = lazyPage(() =>
  import('./friends/FriendLinkPage.tsx').then((m) => m.FriendLinkPage),
);
export const FriendsPage = lazyPage(() =>
  import('./friends/FriendsPage.tsx').then((m) => m.FriendsPage),
);
export const SettingsPage = lazyPage(() =>
  import('./settings/SettingsPage.tsx').then((m) => m.SettingsPage),
);
export const ManageListsPage = lazyPage(() =>
  import('./settings/ManageListsPage.tsx').then((m) => m.ManageListsPage),
);
export const StatsPage = lazyPage(() =>
  import('./settings/StatsSection.tsx').then((m) => m.StatsPage),
);
export const AdminPage = lazyPage(() => import('./admin/AdminPage.tsx').then((m) => m.AdminPage));
export const NotificationsPage = lazyPage(() =>
  import('./notifications/NotificationsPage.tsx').then((m) => m.NotificationsPage),
);
export const ConnectPage = lazyPage(() =>
  import('./native/ConnectPage.tsx').then((m) => m.ConnectPage),
);

/** Fetch every page that loads on first visit (once the app is idle; tests, before they start). */
export function preloadPages(): Promise<unknown> {
  return Promise.all(
    [
      CalendarPage,
      FriendLinkPage,
      FriendsPage,
      SettingsPage,
      ManageListsPage,
      StatsPage,
      AdminPage,
      NotificationsPage,
      ConnectPage,
    ].map((page) => page.preload()),
  );
}
