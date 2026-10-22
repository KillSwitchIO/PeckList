import { Navigate, Route, Routes, useLocation } from 'react-router';
import { t } from './i18n/i18n.ts';
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
import {
  AllView,
  AssignedView,
  SharedView,
  CompletedView,
  TodayView,
  TrashView,
  UpcomingView,
} from './views/TaskViews.tsx';

/** Views that arrive in a later milestone. */
function ComingSoon({ title, milestone }: { title: string; milestone: string }) {
  return (
    <Page title={title}>
      <EmptyState title={t('empty.generic')} hint={t('empty.comingSoon', { milestone })} />
    </Page>
  );
}

function NotFound() {
  const { pathname } = useLocation();
  return (
    <Page title={t('notFound.title')}>
      <EmptyState title={t('notFound.title')} hint={pathname} />
    </Page>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/today" replace />} />
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
        <Route
          path="/calendar"
          element={<ComingSoon title={t('nav.calendar')} milestone="0.3" />}
        />
        <Route path="/search" element={<SearchView />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
