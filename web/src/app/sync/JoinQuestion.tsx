import { Alert, Box, Button } from '@mui/material';
import { useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { CenteredCard } from '../layout/CenteredCard.tsx';
import { useSyncState } from './syncContext.ts';

/**
 * The first sign-in on a device that already has tasks or lists (audit W5): they may be someone
 * else's, on a shared computer, so they join the account only when the person says so. The same
 * question for the tasks a phone made without a server, handed over on connecting (PL-070).
 */
export function JoinQuestion() {
  const account = useSyncState((state) => state.account);
  const join = useSyncState((state) => state.join);
  const answerJoin = useSyncState((state) => state.answerJoin);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'newer' | 'invalid' | null>(null);
  const phone = join === 'phone';
  const name = account?.username ?? '';
  const answer = (keep: boolean) => {
    setBusy(true);
    setProblem(null);
    void answerJoin(keep)
      .then((outcome) => setProblem(outcome === 'ok' ? null : outcome))
      .finally(() => setBusy(false));
  };
  return (
    <CenteredCard
      title={phone ? t('join.phoneTitle') : t('join.title')}
      subtitle={phone ? t('join.phoneText', { name }) : t('join.text', { name })}
    >
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {problem && (
          <Alert severity="warning" variant="outlined">
            {problem === 'newer' ? t('join.phoneNewer') : t('join.phoneInvalid')}
          </Alert>
        )}
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
          {phone ? t('join.phoneLeave') : t('join.leave')}
        </Button>
      </Box>
    </CenteredCard>
  );
}
