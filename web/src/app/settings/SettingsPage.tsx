import { Stack, Switch } from '@mui/material';
import { Navigate, useParams, useSearchParams } from 'react-router';
import {
  AccountIcon,
  BellIcon,
  CalendarIcon,
  ChecklistIcon,
  DataIcon,
  HeartIcon,
  PaletteIcon,
} from '../icons/icons.tsx';
import { t } from '../i18n/i18n.ts';
import { CategoryPage, type PageCategory } from '../layout/CategoryPage.tsx';
import { ServerSection } from '../native/ServerSection.tsx';
import { useShellInfo } from '../native/shell.ts';
import { SupportSection } from '../support/SupportSection.tsx';
import { useSupportVisible } from '../support/useSupportVisible.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { setHideCompleted, useHideCompleted } from '../views/completedPrefs.ts';
import { AppearanceSection } from './AppearanceSection.tsx';
import { DataSection } from './DataSection.tsx';
import { DateTimeSection } from './DateTimeSection.tsx';
import { EmailSection } from './EmailSection.tsx';
import { NewTaskSection } from './NewTaskSection.tsx';
import { NotificationSettings } from './NotificationSettings.tsx';
import { PasskeysSection } from './PasskeysSection.tsx';
import { ProfileSection } from './ProfileSection.tsx';
import { ResetSection } from './ResetSection.tsx';
import { LinkRow, Section, SettingRow } from './settingsLayout.tsx';
import { SignInSection } from './SignInSection.tsx';
import { SwipeSection } from './SwipeSection.tsx';
import { UsageSection } from './UsageSection.tsx';

function AccountCategory() {
  // Servers with accounts only (R-FB-157).
  const accounts = useSyncState(
    (state) => state.phase === 'ready' && state.account?.authMode === 'local',
  );
  return (
    <Stack spacing={4}>
      <ServerSection />
      <ProfileSection />
      <EmailSection />
      <SignInSection />
      <PasskeysSection />
      {accounts && (
        <Section title={t('apiKeys.title')} plain>
          <LinkRow to="/settings/api-keys" label={t('apiKeys.open')} hint={t('apiKeys.openHint')} />
        </Section>
      )}
    </Stack>
  );
}

function TasksCategory() {
  const hideCompleted = useHideCompleted();
  return (
    <Stack spacing={4}>
      <Section title={t('manage.title')} plain>
        <LinkRow to="/settings/lists" label={t('manage.open')} hint={t('manage.openHint')} />
        <SettingRow label={t('settings.showCompleted')} hint={t('settings.showCompletedHint')}>
          <Switch
            checked={!hideCompleted}
            onChange={(event) => setHideCompleted(!event.target.checked)}
            slotProps={{ input: { 'aria-label': t('settings.showCompleted') } }}
          />
        </SettingRow>
      </Section>
      <NewTaskSection />
      <SwipeSection />
    </Stack>
  );
}

function DataCategory() {
  return (
    <Stack spacing={4}>
      <DataSection />
      <UsageSection />
      <ResetSection />
    </Stack>
  );
}

/** Settings (spec: PL-025, laid out by subject in PL-128). */
export function SettingsPage() {
  const { section } = useParams();
  const [params] = useSearchParams();
  const { shell } = useShellInfo();
  const hasAccount = useSyncState((state) => state.account !== null);
  const canNotify = useSyncState(
    (state) => state.phase === 'ready' && Boolean(state.transport.push),
  );
  const supportVisible = useSupportVisible();
  // The server sends confirmation and linking results to /settings: they belong to Account.
  if (!section && (params.has('email') || params.has('link'))) {
    return <Navigate to={`/settings/account?${params.toString()}`} replace />;
  }
  const categories: PageCategory[] = [
    {
      id: 'account',
      label: t('settings.category.account'),
      hint: t('settings.category.accountHint'),
      icon: <AccountIcon />,
      hidden: !hasAccount && !shell,
      content: () => <AccountCategory />,
    },
    {
      id: 'appearance',
      label: t('settings.appearance'),
      hint: t('settings.category.appearanceHint'),
      icon: <PaletteIcon />,
      content: () => <AppearanceSection />,
    },
    {
      id: 'dates',
      label: t('settings.category.dates'),
      hint: t('settings.category.datesHint'),
      icon: <CalendarIcon />,
      content: () => <DateTimeSection />,
    },
    {
      id: 'tasks',
      label: t('settings.category.tasks'),
      hint: t('settings.category.tasksHint'),
      icon: <ChecklistIcon />,
      content: () => <TasksCategory />,
    },
    {
      id: 'notifications',
      label: t('notifications.settings'),
      hint: t('settings.category.notificationsHint'),
      icon: <BellIcon />,
      hidden: !canNotify,
      content: () => (
        <Stack spacing={4}>
          <NotificationSettings />
        </Stack>
      ),
    },
    {
      id: 'data',
      label: t('settings.data'),
      hint: t('settings.category.dataHint'),
      icon: <DataIcon />,
      content: () => <DataCategory />,
    },
    // Left out rather than hidden: a hidden subject's address would still open it.
    ...(supportVisible
      ? [
          {
            id: 'support',
            label: t('support.title'),
            hint: t('settings.category.supportHint'),
            icon: <HeartIcon />,
            content: () => <SupportSection />,
          },
        ]
      : []),
  ];
  return (
    <CategoryPage
      title={t('nav.settings')}
      base="/settings"
      categories={categories}
      current={section}
    />
  );
}
