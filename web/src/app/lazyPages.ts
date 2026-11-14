// The pages split off the app's first load (R-FB-94).

import type { ComponentType } from 'react';
import { lazyAgain } from './lazyAgain.tsx';
import { importAgain, loadOnce } from './loadOnce.ts';

/**
 * A page that loads on first visit (R-FB-94): settings, admin, the calendar and the like are a
 * tenth of the app's code, not needed to show the task lists. `preload` fetches it ahead (the app
 * does once idle, so pages open offline and without a wait). A failure is not kept: a page that
 * could not load says so in the page area, and the next visit asks again, by a new address.
 */
function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  const preload = loadOnce(() => load().then((component) => ({ default: component })));
  return Object.assign(lazyAgain(preload), { preload });
}

export const CalendarPage = lazyPage(() =>
  importAgain(() => import('./calendar/CalendarPage.tsx')).then((m) => m.CalendarPage),
);
export const FriendLinkPage = lazyPage(() =>
  importAgain(() => import('./friends/FriendLinkPage.tsx')).then((m) => m.FriendLinkPage),
);
export const FriendsPage = lazyPage(() =>
  importAgain(() => import('./friends/FriendsPage.tsx')).then((m) => m.FriendsPage),
);
export const SettingsPage = lazyPage(() =>
  importAgain(() => import('./settings/SettingsPage.tsx')).then((m) => m.SettingsPage),
);
export const ManageListsPage = lazyPage(() =>
  importAgain(() => import('./settings/ManageListsPage.tsx')).then((m) => m.ManageListsPage),
);
export const ApiKeysPage = lazyPage(() =>
  importAgain(() => import('./settings/ApiKeysPage.tsx')).then((m) => m.ApiKeysPage),
);
export const CliSignInPage = lazyPage(() =>
  importAgain(() => import('./settings/CliSignInPage.tsx')).then((m) => m.CliSignInPage),
);
export const StatsPage = lazyPage(() =>
  importAgain(() => import('./settings/StatsSection.tsx')).then((m) => m.StatsPage),
);
export const AdminPage = lazyPage(() =>
  importAgain(() => import('./admin/AdminPage.tsx')).then((m) => m.AdminPage),
);
export const NotificationsPage = lazyPage(() =>
  importAgain(() => import('./notifications/NotificationsPage.tsx')).then(
    (m) => m.NotificationsPage,
  ),
);
export const ConnectPage = lazyPage(() =>
  importAgain(() => import('./native/ConnectPage.tsx')).then((m) => m.ConnectPage),
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
      ApiKeysPage,
      CliSignInPage,
      StatsPage,
      AdminPage,
      NotificationsPage,
      ConnectPage,
    ].map((page) => page.preload()),
  );
}
