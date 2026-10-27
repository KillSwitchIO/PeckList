import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import type { ServerProblem } from '../../ports/nativeShell.ts';
import { t } from '../i18n/i18n.ts';
import { CenteredCard } from '../layout/CenteredCard.tsx';
import { rememberStandalone, useShellInfo } from './shell.ts';

type Step =
  | { kind: 'typing' }
  | { kind: 'checking' }
  | { kind: 'problem'; problem: ServerProblem }
  /** Found, but on plain http: say what that means before going there. */
  | { kind: 'plain-http'; url: string }
  /** Behind a sign-in page (Pangolin, Cloudflare Access...): passed once connected. */
  | { kind: 'gated'; url: string }
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
    if (!answer.ok && answer.problem === 'gated' && answer.url)
      setStep({ kind: 'gated', url: answer.url });
    else if (!answer.ok) setStep({ kind: 'problem', problem: answer.problem });
    else if (answer.url.startsWith('http://')) setStep({ kind: 'plain-http', url: answer.url });
    else await go(answer.url);
  };

  const busy = step.kind === 'checking' || step.kind === 'connecting';
  return (
    <CenteredCard title={t('connect.title')} subtitle={t('connect.subtitle')}>
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
        {step.kind === 'gated' && (
          <Alert
            severity="info"
            sx={{ mt: 2 }}
            action={
              <Button color="inherit" size="small" onClick={() => void go(step.url)}>
                {t('connect.continue')}
              </Button>
            }
          >
            {t('connect.gated')}
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
          disabled={
            busy || address.trim() === '' || step.kind === 'plain-http' || step.kind === 'gated'
          }
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
    </CenteredCard>
  );
}
