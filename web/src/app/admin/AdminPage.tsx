import { Box, Tab, Tabs, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { BackupsTab } from './BackupsTab.tsx';
import { GroupsTab } from './GroupsTab.tsx';
import { LogsTab } from './LogsTab.tsx';
import { StatsTab } from './StatsTab.tsx';
import { SettingsTab } from './SettingsTab.tsx';
import { SignInTab } from './SignInTab.tsx';
import { UsersTab } from './UsersTab.tsx';
import { useAdminApi } from './useAdmin.ts';

const TABS = ['users', 'groups', 'sign-in', 'backups', 'logs', 'stats', 'settings'] as const;
type AdminTab = (typeof TABS)[number];
const isTab = (value: string | undefined): value is AdminTab => TABS.some((each) => each === value);

/**
 * The admin area (spec: PL-034 Admin UI): users, server groups, sign-in, backups, logs, stats and
 * settings. The server checks every action too; this page only
 * shows for admins.
 */
export function AdminPage() {
  const api = useAdminApi();
  const params = useParams();
  const navigate = useNavigate();
  const tab: AdminTab = isTab(params.tab) ? params.tab : 'users';
  if (!api) {
    return (
      <Page title={t('admin.title')}>
        <Typography color="text.secondary">{t('admin.notAllowed')}</Typography>
      </Page>
    );
  }
  return (
    <Page title={t('admin.title')}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, maxWidth: 720 }}>
        <Tabs
          value={tab}
          onChange={(_, next: AdminTab) =>
            void navigate(next === 'users' ? '/admin' : `/admin/${next}`)
          }
        >
          {TABS.map((each) => (
            <Tab
              key={each}
              value={each}
              label={t(`admin.tab.${each}`)}
              sx={{ textTransform: 'none' }}
            />
          ))}
        </Tabs>
      </Box>
      {tab === 'users' && <UsersTab api={api} />}
      {tab === 'groups' && <GroupsTab api={api} />}
      {tab === 'sign-in' && <SignInTab api={api} />}
      {tab === 'backups' && <BackupsTab api={api} />}
      {tab === 'logs' && <LogsTab api={api} />}
      {tab === 'stats' && <StatsTab api={api} />}
      {tab === 'settings' && <SettingsTab api={api} />}
    </Page>
  );
}
