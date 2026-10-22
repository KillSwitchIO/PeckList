import { Box } from '@mui/material';
import { useEffect, useState } from 'react';
import type { UserStats } from '../../ports/stats.ts';
import { MonthBars, StatCard } from '../admin/statsParts.tsx';
import { t } from '../i18n/i18n.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { Section } from './settingsLayout.tsx';

/** "Your stats" (spec: Server stats): the same numbers an admin sees for this account. Servers with accounts only. */
export function StatsSection() {
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

  if (!stats) return null;
  const cards: [string, number][] = [
    [t('stats.open'), stats.openTasks],
    [t('stats.closed'), stats.closedTasks],
    [t('stats.closedThisMonth'), stats.closedThisMonth],
    [t('stats.created'), stats.createdTasks],
    [t('stats.lists'), stats.lists],
    [t('stats.sharedLists'), stats.sharedLists],
  ];
  return (
    <Section title={t('stats.yours')}>
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
    </Section>
  );
}
