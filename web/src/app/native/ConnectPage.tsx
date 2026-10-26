import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import type { ServerProblem } from '../../ports/nativeShell.ts';
import { t } from '../i18n/i18n.ts';
import { rememberStandalone, useShellInfo } from './shell.ts';

type Step =
  | { kind: 'typing' }
  | { kind: 'checking' }
  | { kind: 'problem'; problem: ServerProblem }
  /** Found, but on plain http: say what that means before going there. */
  | { kind: 'plain-http'; url: string }
  | { kind: 'connecting'; url: string };

/**
 * The Android app's way onto a server (ADR-0017): type its address, the app checks it really is a
 * Punchlist server, then restarts on it. Shown on first start, from Settings > Server and from the
 * sign-in page. `onBack` leaves without connecting (after "Use on this device only", that choice
 * is remembered first).
 */
export function ConnectPage({ onBack }: { onBack: () => void }) {
  const { shell, info } = useShellInfo();
  const [address, setAddress] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'typing' });
  const onServer = info?.server != null;

  const go = async (url: string) => {
    setStep({ kind: 'connecting', url });
    await shell?.connect(url);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!shell || address.trim() === '') return;
    setStep({ kind: 'checking' });
    const answer = await shell.checkServer(address);
    if (!answer.ok) setStep({ kind: 'problem', problem: answer.problem });
    else if (answer.url.startsWith('http://')) setStep({ kind: 'plain-http', url: answer.url });
    else await go(answer.url);
  };

  const busy = step.kind === 'checking' || step.kind === 'connecting';
  return (
    <Box
      component="main"
      sx={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        px: 2,
        pt: 'env(safe-area-inset-top)',
        pb: 'env(safe-area-inset-bottom)',
        bgcolor: 'background.default',
      }}
    >
      <Paper
        variant="outlined"
        sx={{ width: '100%', maxWidth: 380, p: { xs: 3, sm: 4 }, borderRadius: 3 }}
      >
        <Typography variant="h1" sx={{ fontSize: '1.375rem', mb: 0.5 }}>
          {t('connect.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('connect.subtitle')}
        </Typography>
        <Box component="form" onSubmit={(event) => void submit(event)} noValidate>
          <TextField
            fullWidth
            autoFocus
            label={t('connect.address')}
            placeholder="punchlist.example.com"
            value={address}
            disabled={busy}
            onChange={(event) => {
              setAddress(event.target.value);
              if (step.kind !== 'typing') setStep({ kind: 'typing' });
            }}
            slotProps={{
              htmlInput: {
                inputMode: 'url',
                autoCapitalize: 'none',
                autoCorrect: 'off',
                spellCheck: false,
              },
            }}
          />
          {step.kind === 'problem' && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {t(`connect.problem.${step.problem}`)}
            </Alert>
          )}
          {step.kind === 'plain-http' && (
            <Alert
              severity="warning"
              sx={{ mt: 2 }}
              action={
                <Button color="inherit" size="small" onClick={() => void go(step.url)}>
                  {t('connect.anyway')}
                </Button>
              }
            >
              {t('connect.plainHttp')}
            </Alert>
          )}
          <Button
            type="submit"
            fullWidth
            variant="contained"
            disableElevation
            disabled={busy || address.trim() === '' || step.kind === 'plain-http'}
            sx={{ mt: 2 }}
          >
            {step.kind === 'checking'
              ? t('connect.checking')
              : step.kind === 'connecting'
                ? t('connect.connecting')
                : t('connect.connect')}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>
          {t('connect.dataStays')}
        </Typography>
        <Button
          fullWidth
          disabled={busy}
          sx={{ mt: 1 }}
          onClick={() => {
            if (onServer) {
              void shell?.disconnect();
              return;
            }
            rememberStandalone();
            onBack();
          }}
        >
          {t('connect.deviceOnly')}
        </Button>
        {onServer && (
          <Button fullWidth disabled={busy} onClick={onBack}>
            {t('common.cancel')}
          </Button>
        )}
      </Paper>
    </Box>
  );
}
