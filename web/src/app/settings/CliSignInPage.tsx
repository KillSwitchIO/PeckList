import TerminalRounded from '@mui/icons-material/TerminalRounded';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { CliSignInProblem, CliSignInRequest } from '../../ports/sync.ts';
import { t, type MessageKey } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { formatCode } from './cliCode.ts';

const PROBLEMS: Record<CliSignInProblem, MessageKey> = {
  not_found: 'cliSignIn.notFound',
  too_many_tries: 'cliSignIn.tooMany',
  not_allowed: 'cliSignIn.notAllowed',
  failed: 'cliSignIn.failed',
};

function problemText(problem: CliSignInProblem): string {
  return t(PROBLEMS[problem]);
}

/**
 * `/cli`: approving a terminal's sign-in (PL-133). The person types the code the terminal shows
 * (it is never in a link, so a link alone approves nothing), sees which terminal asked, when and
 * from where, and approves or denies. The admin permission is a separate box, off by default,
 * offered only when the terminal asked for it and the person's role allows it.
 */
export function CliSignInPage() {
  const navigate = useNavigate();
  const phase = useSyncState((state) => state.phase);
  const api = useSyncState((state) => state.transport.cliSignIn);
  const [code, setCode] = useState('');
  const [request, setRequest] = useState<CliSignInRequest | null>(null);
  const [admin, setAdmin] = useState(false);
  const [problem, setProblem] = useState<CliSignInProblem | null>(null);
  const [done, setDone] = useState<{ approved: string } | 'denied' | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCode('');
    setRequest(null);
    setAdmin(false);
    setProblem(null);
    setDone(null);
  };

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch {
      setProblem('failed');
    } finally {
      setBusy(false);
    }
  };

  const lookUp = () =>
    act(async () => {
      if (!api) return;
      const found = await api.lookup(code);
      if ('problem' in found) setProblem(found.problem);
      else setRequest(found);
    });

  const approve = () =>
    act(async () => {
      if (!api || !request) return;
      const made = await api.approve(request.userCode, admin && request.mayGrantAdmin);
      if ('problem' in made) setProblem(made.problem);
      else setDone({ approved: made.keyName });
    });

  const deny = () =>
    act(async () => {
      if (!api || !request) return;
      const refused = await api.deny(request.userCode);
      if (refused) setProblem(refused.problem);
      else setDone('denied');
    });

  let body: React.ReactNode;
  if (phase !== 'ready' || !api) {
    body = <Typography color="text.secondary">{t('cliSignIn.needsServer')}</Typography>;
  } else if (done) {
    body = (
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        <Alert severity={done === 'denied' ? 'info' : 'success'} variant="outlined">
          {done === 'denied'
            ? t('cliSignIn.denied')
            : t('cliSignIn.approved', { name: done.approved })}
        </Alert>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={reset}>{t('cliSignIn.another')}</Button>
          <Button onClick={() => void navigate('/settings/api-keys')}>
            {t('cliSignIn.toKeys')}
          </Button>
        </Box>
      </Stack>
    );
  } else if (!request) {
    body = (
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void lookUp();
        }}
        sx={{ display: 'grid', gap: 2, maxWidth: 420 }}
      >
        <Typography color="text.secondary">{t('cliSignIn.intro')}</Typography>
        <TextField
          label={t('cliSignIn.code')}
          value={code}
          onChange={(event) => setCode(formatCode(event.target.value))}
          autoFocus
          autoComplete="off"
          slotProps={{
            htmlInput: {
              spellCheck: false,
              autoCapitalize: 'characters',
              style: { fontFamily: 'monospace', letterSpacing: '0.15em', fontSize: '1.25rem' },
            },
          }}
        />
        {problem && (
          <Alert severity="warning" variant="outlined">
            {problemText(problem)}
          </Alert>
        )}
        <Button
          type="submit"
          variant="contained"
          disableElevation
          disabled={busy || code.length !== 9}
          sx={{ justifySelf: 'start' }}
        >
          {t('cliSignIn.continue')}
        </Button>
      </Box>
    );
  } else {
    const time = new Date(request.requestedAt).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    const elsewhere =
      request.address !== null &&
      request.yourAddress !== null &&
      request.address !== request.yourAddress;
    body = (
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, maxWidth: 480 }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TerminalRounded color="action" />
            <Typography variant="h6" component="p">
              {t('cliSignIn.device', { name: request.name })}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              {request.address
                ? t('cliSignIn.asked', { time, address: request.address })
                : t('cliSignIn.askedNoAddress', { time })}
            </Typography>
            {request.yourAddress && (
              <Typography variant="body2" color="text.secondary">
                {t('cliSignIn.youAre', { address: request.yourAddress })}
              </Typography>
            )}
          </Box>
          {elsewhere && (
            <Alert severity="warning" variant="outlined">
              {t('cliSignIn.otherAddress')}
            </Alert>
          )}
          <Typography>{t('cliSignIn.mayDo')}</Typography>
          {request.mayGrantAdmin && (
            <Box>
              <FormControlLabel
                control={
                  <Checkbox checked={admin} onChange={(event) => setAdmin(event.target.checked)} />
                }
                label={t('cliSignIn.admin')}
              />
              <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                {t('cliSignIn.adminHint')}
              </Typography>
            </Box>
          )}
          <Alert severity="info" variant="outlined">
            {t('cliSignIn.warning')}
          </Alert>
          {problem && (
            <Alert severity="warning" variant="outlined">
              {problemText(problem)}
            </Alert>
          )}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button onClick={() => void deny()} disabled={busy}>
              {t('cliSignIn.deny')}
            </Button>
            <Button
              variant="contained"
              disableElevation
              onClick={() => void approve()}
              disabled={busy}
            >
              {t('cliSignIn.approve')}
            </Button>
          </Box>
        </Stack>
      </Paper>
    );
  }
  return <Page title={t('cliSignIn.title')}>{body}</Page>;
}
