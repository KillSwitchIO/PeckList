import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import {
  AccountIcon,
  ArchiveIcon,
  ChartIcon,
  HeartIcon,
  KeyIcon,
  MailIcon,
  NotesLinesIcon,
  PeopleIcon,
  SlidersIcon,
} from '../icons/icons.tsx';
import { t } from '../i18n/i18n.ts';
import { CategoryPage, type PageCategory } from '../layout/CategoryPage.tsx';
import { Page } from '../layout/Page.tsx';
import { BackupsTab } from './BackupsTab.tsx';
import { GroupsTab } from './GroupsTab.tsx';
import { LogsTab } from './LogsTab.tsx';
import { SetupCard } from './SetupCard.tsx';
import { SETTINGS_ON } from './settingsGroups.ts';
import { SettingsTab } from './SettingsTab.tsx';
import { SetupWizard } from './SetupWizard.tsx';
import { SignInTab } from './SignInTab.tsx';
import { StatsTab } from './StatsTab.tsx';
import { SupportTab } from './SupportTab.tsx';
import { UsersTab } from './UsersTab.tsx';
import { useAdminApi } from './useAdmin.ts';

/**
 * The admin area (spec: PL-034 Admin UI, laid out by subject in PL-128). A server setting lives on
 * the page about its subject: backups' schedule on Backups, log levels on Logs. The server checks
 * every action too; this page only shows for admins.
 */
export function AdminPage() {
  const api = useAdminApi();
  const params = useParams();
  if (!api) {
    return (
      <Page title={t('admin.title')}>
        <Typography color="text.secondary">{t('admin.notAllowed')}</Typography>
      </Page>
    );
  }
  if (params.tab === 'setup') {
    return (
      <Page title={t('admin.title')}>
        <SetupWizard api={api} />
      </Page>
    );
  }
  // Its old address.
  if (params.tab === 'settings') return <Navigate to="/admin/general" replace />;
  const padded = (content: ReactNode) => <Box sx={{ pb: 10 }}>{content}</Box>;
  const categories: PageCategory[] = [
    {
      id: 'users',
      label: t('admin.tab.users'),
      hint: t('admin.tab.usersHint'),
      heading: t('admin.heading.people'),
      icon: <AccountIcon />,
      content: () => padded(<UsersTab api={api} />),
    },
    {
      id: 'groups',
      label: t('admin.tab.groups'),
      hint: t('admin.tab.groupsHint'),
      icon: <PeopleIcon />,
      content: () => padded(<GroupsTab api={api} />),
    },
    {
      id: 'sign-in',
      label: t('admin.tab.sign-in'),
      hint: t('admin.tab.signInHint'),
      icon: <KeyIcon />,
      content: () => padded(<SignInTab api={api} />),
    },
    {
      id: 'general',
      label: t('admin.tab.general'),
      hint: t('admin.tab.generalHint'),
      heading: t('admin.heading.server'),
      icon: <SlidersIcon />,
      content: () => padded(<SettingsTab api={api} only={SETTINGS_ON.general} />),
    },
    {
      id: 'email',
      label: t('admin.tab.email'),
      hint: t('admin.tab.emailHint'),
      icon: <MailIcon />,
      content: () => padded(<SettingsTab api={api} only={SETTINGS_ON.email} />),
    },
    {
      id: 'backups',
      label: t('admin.tab.backups'),
      hint: t('admin.tab.backupsHint'),
      icon: <ArchiveIcon />,
      content: () => padded(<BackupsTab api={api} />),
    },
    {
      id: 'support',
      label: t('admin.tab.support'),
      hint: t('admin.tab.supportHint'),
      icon: <HeartIcon />,
      content: () => padded(<SupportTab api={api} />),
    },
    {
      id: 'logs',
      label: t('admin.tab.logs'),
      hint: t('admin.tab.logsHint'),
      heading: t('admin.heading.activity'),
      icon: <NotesLinesIcon />,
      content: () => padded(<LogsTab api={api} />),
    },
    {
      id: 'stats',
      label: t('admin.tab.stats'),
      hint: t('admin.tab.statsHint'),
      icon: <ChartIcon />,
      content: () => padded(<StatsTab api={api} />),
    },
  ];
  return (
    <CategoryPage
      title={t('admin.title')}
      base="/admin"
      categories={categories}
      current={params.tab}
      phoneTop={<SetupCard api={api} />}
    />
  );
}
