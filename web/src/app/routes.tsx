import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { t } from './i18n/i18n.ts';
import { AppShell } from './layout/AppShell.tsx';
import { EmptyState } from './views/EmptyState.tsx';
import { VIEW_ROUTES, type ViewRoute } from './viewRoutes.ts';

function Placeholder({ route }: { route: ViewRoute }) {
  return route.empty ? (
    <EmptyState
      title={t(route.empty.title)}
      {...(route.empty.hint ? { hint: t(route.empty.hint) } : {})}
    />
  ) : (
    <EmptyState
      title={t('empty.generic')}
      hint={t('empty.comingSoon', { milestone: route.milestone })}
    />
  );
}

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return <AppShell title={title}>{children}</AppShell>;
}

function NotFound() {
  const { pathname } = useLocation();
  return (
    <Screen title={t('notFound.title')}>
      <EmptyState title={t('notFound.title')} hint={pathname} />
    </Screen>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/today" replace />} />
      {VIEW_ROUTES.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={
            <Screen title={t(route.title)}>
              <Placeholder route={route} />
            </Screen>
          }
        />
      ))}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
