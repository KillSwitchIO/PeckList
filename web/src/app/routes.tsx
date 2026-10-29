import { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { t } from './i18n/i18n.ts';
import { DayView } from './views/DayView.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { Page } from './layout/Page.tsx';
import { InboxView, ListView } from './lists/ListView.tsx';
import { FilterView } from './filters/FilterView.tsx';
import { TagView } from './tags/TagView.tsx';
import { EmptyState } from './views/EmptyState.tsx';
import { MoreView } from './views/MoreView.tsx';
import { SearchView } from './search/SearchView.tsx';
import { useSyncState } from './sync/syncContext.ts';
import {
  AllView,
  AssignedView,
  SharedView,
  CompletedView,
  TodayView,
  TrashView,
  UpcomingView,
} from './views/TaskViews.tsx';
import { DueDatesView } from './views/DueDatesView.tsx';
import { useShellInfo } from './native/shell.ts';
import {
  AdminPage,
  CalendarPage,
  ConnectPage,
  FriendLinkPage,
  FriendsPage,
  NotificationsPage,
  SettingsPage,
  ManageListsPage,
  ApiKeysPage,
  StatsPage,
} from './lazyPages.ts';

function NotFound() {
  const { pathname } = useLocation();
  return (
    <Page title={t('notFound.title')}>
      <EmptyState title={t('notFound.title')} hint={pathname} />
    </Page>
  );
}

/**
 * A sign-in, sign-up or invite address opened by someone already in: on to the app. Not while the
 * server is still being asked, since the sign-in pages need the address (an invite, an error).
 */
function SignedInAlready() {
  const phase = useSyncState((state) => state.phase);
  return phase === 'checking' ? null : <Navigate to="/today" replace />;
}

/** The Android app's connect page (ADR-0017); back to Settings when on a server, else Today. */
function ConnectRoute() {
  const navigate = useNavigate();
  const { info } = useShellInfo();
  return (
    <ConnectPage
      onBack={() => void navigate(info?.server ? '/settings' : '/today', { replace: true })}
    />
  );
}

export function AppRoutes() {
  return (
    // Pages inside the shell wait inside it (AppShell); this covers the ones outside it.
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/login" element={<SignedInAlready />} />
        <Route path="/signup" element={<SignedInAlready />} />
        <Route path="/join/:token" element={<SignedInAlready />} />
        <Route path="/connect" element={<ConnectRoute />} />
        <Route element={<AppShell />}>
          <Route path="/today" element={<TodayView />} />
          <Route path="/inbox" element={<InboxView />} />
          <Route path="/upcoming" element={<UpcomingView />} />
          <Route path="/due" element={<DueDatesView />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/all" element={<AllView />} />
          <Route path="/lists/:listId" element={<ListView />} />
          <Route path="/tags/:tagId" element={<TagView />} />
          <Route path="/filters/:filterId" element={<FilterView />} />
          <Route path="/completed" element={<CompletedView />} />
          <Route path="/trash" element={<TrashView />} />
          <Route path="/more" element={<MoreView />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/assigned" element={<AssignedView />} />
          <Route path="/shared" element={<SharedView />} />
          <Route path="/f/:code" element={<FriendLinkPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/day/:date" element={<DayView />} />
          <Route path="/search" element={<SearchView />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/lists" element={<ManageListsPage />} />
          <Route path="/settings/api-keys" element={<ApiKeysPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/:tab" element={<AdminPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
