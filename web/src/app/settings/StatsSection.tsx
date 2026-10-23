import { Box } from '@mui/material';
import { useEffect, useState } from 'react';
import type { UserStats } from '../../ports/stats.ts';
import { MonthBars, StatCard } from '../admin/statsParts.tsx';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { EmptyState } from '../views/EmptyState.tsx';

/**
 * "Your stats" (spec: Server stats, PL-084), from the profile menu: the same numbers an admin sees
 * for this account. Servers with accounts only.
 */
export function StatsPage() {
  const transport = useSyncState((state) => state.transport);
  const hasAccounts = useSyncState(
    (state) => state.phase === 'ready' && state.account?.authMode === 'local',
  );
  const api = hasAccounts ? transport.account : undefined;
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.stats().then(
      (value) => live && setStats(value),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!api) {
    return (
      <Page title={t('stats.yours')}>
        <EmptyState title={t('stats.needsServer')} />
      </Page>
    );
  }
  if (!stats) return <Page title={t('stats.yours')}>{null}</Page>;
  const cards: [string, number][] = [
    [t('stats.open'), stats.openTasks],
    [t('stats.closed'), stats.closedTasks],
    [t('stats.closedThisMonth'), stats.closedThisMonth],
    [t('stats.created'), stats.createdTasks],
    [t('stats.lists'), stats.lists],
    [t('stats.sharedLists'), stats.sharedLists],
  ];
  return (
    <Page title={t('stats.yours')}>
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          px: 1,
        }}
      >
        {cards.map(([label, value]) => (
          <StatCard key={label} label={label} value={value.toLocaleString()} />
        ))}
      </Box>
      <Box sx={{ px: 1 }}>
        <MonthBars months={stats.closedByMonth} label={t('stats.byMonth')} />
      </Box>
    </Page>
  );
}
