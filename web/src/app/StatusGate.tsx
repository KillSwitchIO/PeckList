import { Alert, AlertTitle, Box, Button, CircularProgress } from '@mui/material';
import type { ReactNode } from 'react';
import { t } from './i18n/i18n.ts';
import { useStoreState } from './store/hooks.ts';

/** Renders the app only once the workspace is open; explains anything that stops it opening. */
export function StatusGate({ children }: { children: ReactNode }) {
  const status = useStoreState((state) => state.status);
  const problem = useStoreState((state) => state.problem);
  const upgrade = useStoreState((state) => state.upgrade);

  if (status === 'ready') return <>{children}</>;
  if (status === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress aria-label={t('status.loading')} />
      </Box>
    );
  }

  const details =
    problem?.kind === 'needs-app-update'
      ? t('status.needsAppUpdate.body', { file: problem.fileVersion, app: problem.supported })
      : problem?.kind === 'needs-upgrade'
        ? t('status.needsUpgrade.body', { from: problem.from, to: problem.to })
        : problem?.kind === 'invalid'
          ? problem.errors.slice(0, 5).join('\n')
          : problem?.kind === 'error'
            ? problem.message
            : '';

  const title =
    status === 'needs-app-update'
      ? t('status.needsAppUpdate.title')
      : status === 'needs-upgrade'
        ? t('status.needsUpgrade.title')
        : t('status.error.title');

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 2 }}>
      <Alert
        severity={status === 'error' ? 'error' : 'warning'}
        sx={{ maxWidth: 560, whiteSpace: 'pre-wrap' }}
        action={
          status === 'needs-app-update' ? (
            <Button color="inherit" onClick={() => window.location.reload()}>
              {t('pwa.reload')}
            </Button>
          ) : status === 'needs-upgrade' ? (
            <Button color="inherit" onClick={() => void upgrade()} sx={{ whiteSpace: 'nowrap' }}>
              {t('status.needsUpgrade.action')}
            </Button>
          ) : undefined
        }
      >
        <AlertTitle>{title}</AlertTitle>
        {details}
      </Alert>
    </Box>
  );
}
