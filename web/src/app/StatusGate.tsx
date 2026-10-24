import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import SystemUpdateAltRounded from '@mui/icons-material/SystemUpdateAltRounded';
import UpgradeRounded from '@mui/icons-material/UpgradeRounded';
import { alpha, Box, Button, CircularProgress, Typography, useTheme } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { t } from './i18n/i18n.ts';
import { useStoreState } from './store/hooks.ts';

/** Renders the app only once the workspace is open; explains anything that stops it opening. */
export function StatusGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const status = useStoreState((state) => state.status);
  const problem = useStoreState((state) => state.problem);
  const upgrade = useStoreState((state) => state.upgrade);
  const [upgrading, setUpgrading] = useState(false);

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
  const failed = status === 'error';
  const color = failed ? theme.palette.error.main : theme.palette.warning.main;
  const Icon =
    status === 'needs-app-update'
      ? SystemUpdateAltRounded
      : status === 'needs-upgrade'
        ? UpgradeRounded
        : ErrorOutlineRounded;

  // A card in the middle of the page: icon, title, what happened, then the one thing to do.
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: 'center',
        px: 2,
        pt: { xs: 8, sm: 2 },
        pb: 2,
        bgcolor: 'background.default',
      }}
    >
      <Box
        role={failed ? 'alert' : 'status'}
        sx={{
          width: '100%',
          maxWidth: 480,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color,
            bgcolor: alpha(color, 0.14),
          }}
        >
          <Icon />
        </Box>
        <Typography variant="h2" component="h1">
          {title}
        </Typography>
        {details &&
          (problem?.kind === 'invalid' ? (
            // Validation errors are paths and rules: keep their lines, let them scroll.
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                width: '100%',
                maxHeight: '40dvh',
                overflow: 'auto',
                textAlign: 'left',
                typography: 'body2',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                borderRadius: 1,
                bgcolor: 'action.hover',
              }}
            >
              {details}
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {details}
            </Typography>
          ))}
        {status === 'needs-app-update' && (
          <Button
            variant="contained"
            disableElevation
            size="large"
            onClick={() => window.location.reload()}
            sx={{ width: { xs: '100%', sm: 'auto' }, mt: 1 }}
          >
            {t('pwa.reload')}
          </Button>
        )}
        {status === 'needs-upgrade' && (
          <Button
            variant="contained"
            disableElevation
            size="large"
            disabled={upgrading}
            onClick={() => {
              setUpgrading(true);
              void upgrade().finally(() => setUpgrading(false));
            }}
            sx={{ width: { xs: '100%', sm: 'auto' }, mt: 1 }}
          >
            {t('status.needsUpgrade.action')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
