import { Navigate, Route, Routes, useLocation } from 'react-router';
import { t } from './i18n/i18n.ts';
import { CalendarPage } from './calendar/CalendarPage.tsx';
import { DayView } from './views/DayView.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { Page } from './layout/Page.tsx';
import { InboxView, ListView } from './lists/ListView.tsx';
import { FilterView } from './filters/FilterView.tsx';
import { FriendLinkPage } from './friends/FriendLinkPage.tsx';
import { FriendsPage } from './friends/FriendsPage.tsx';
import { TagView } from './tags/TagView.tsx';
import { EmptyState } from './views/EmptyState.tsx';
import { MoreView } from './views/MoreView.tsx';
import { SearchView } from './search/SearchView.tsx';
import { SettingsPage } from './settings/SettingsPage.tsx';
import { StatsPage } from './settings/StatsSection.tsx';
import { AdminPage } from './admin/AdminPage.tsx';
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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/today" replace />} />
      <Route path="/login" element={<SignedInAlready />} />
      <Route path="/signup" element={<SignedInAlready />} />
      <Route path="/join/:token" element={<SignedInAlready />} />
      <Route element={<AppShell />}>
        <Route path="/today" element={<TodayView />} />
        <Route path="/inbox" element={<InboxView />} />
        <Route path="/upcoming" element={<UpcomingView />} />
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
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/:tab" element={<AdminPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
