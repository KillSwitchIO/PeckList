import { Box, Button } from '@mui/material';
import { useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { CenteredCard } from '../layout/CenteredCard.tsx';
import { useSyncState } from './syncContext.ts';

/**
 * The first sign-in on a device that already has tasks or lists (audit W5): they may be someone
 * else's, on a shared computer, so they join the account only when the person says so.
 */
export function JoinQuestion() {
  const account = useSyncState((state) => state.account);
  const answerJoin = useSyncState((state) => state.answerJoin);
  const [busy, setBusy] = useState(false);
  const answer = (keep: boolean) => {
    setBusy(true);
    void answerJoin(keep).finally(() => setBusy(false));
  };
  return (
    <CenteredCard
      title={t('join.title')}
      subtitle={t('join.text', { name: account?.username ?? '' })}
    >
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        <Button
          variant="contained"
          size="large"
          disableElevation
          disabled={busy}
          onClick={() => answer(true)}
        >
          {t('join.keep')}
        </Button>
        <Button size="large" disabled={busy} onClick={() => answer(false)}>
          {t('join.leave')}
        </Button>
      </Box>
    </CenteredCard>
  );
}
