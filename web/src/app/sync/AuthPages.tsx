import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { useState, type FormEvent, type ReactNode } from 'react';
import { SyncFailure } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { useSyncState } from './syncContext.ts';

/** The page a server shows before the app: sign in, or replace a given password. */
export function AuthPages({ phase }: { phase: 'signed-out' | 'password-change' }) {
  return phase === 'signed-out' ? <SignIn /> : <ChangePassword />;
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Box
      component="main"
      sx={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        px: 2,
        bgcolor: 'background.default',
      }}
    >
      <Paper
        variant="outlined"
        sx={{ width: '100%', maxWidth: 380, p: { xs: 3, sm: 4 }, borderRadius: 3 }}
      >
        <Typography variant="h1" sx={{ fontSize: '1.375rem', mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {subtitle}
        </Typography>
        {children}
      </Paper>
    </Box>
  );
}

/** When a lock ends, as a time of day. */
function untilTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Network trouble reads as "cannot reach the server"; anything else shows its message. */
function problemOf(error: unknown): string {
  if (error instanceof SyncFailure && error.kind === 'offline') return t('auth.offline');
  return error instanceof Error ? error.message : String(error);
}

function SignIn() {
  const signIn = useSyncState((state) => state.signIn);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await signIn(username, password);
      if (outcome.kind === 'invalid') setProblem(t('auth.invalid'));
      else if (outcome.kind === 'locked')
        setProblem(t('auth.locked', { time: untilTime(outcome.until) }));
      else if (outcome.kind === 'too-many') setProblem(t('auth.tooMany'));
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('auth.title')} subtitle={t('auth.subtitle')}>
      <Box
        component="form"
        onSubmit={(event) => void submit(event)}
        sx={{ display: 'grid', gap: 2 }}
      >
        <TextField
          label={t('auth.username')}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoFocus
          required
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
        />
        <TextField
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        {problem && (
          <Alert severity="error" variant="outlined">
            {problem}
          </Alert>
        )}
        <Button type="submit" variant="contained" size="large" disableElevation disabled={busy}>
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </Box>
    </Card>
  );
}

function ChangePassword() {
  const changePassword = useSyncState((state) => state.changePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await changePassword(current, next);
      if (outcome.kind === 'wrong-password') setProblem(t('auth.wrongPassword'));
      else if (outcome.kind === 'too-short') setProblem(t('auth.tooShort'));
      else if (outcome.kind === 'unchanged') setProblem(t('auth.unchanged'));
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('auth.changeTitle')} subtitle={t('auth.changeSubtitle')}>
      <Box
        component="form"
        onSubmit={(event) => void submit(event)}
        sx={{ display: 'grid', gap: 2 }}
      >
        <TextField
          label={t('auth.current')}
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          autoFocus
          required
        />
        <TextField
          label={t('auth.new')}
          type="password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          helperText={t('auth.newHint')}
          required
        />
        {problem && (
          <Alert severity="error" variant="outlined">
            {problem}
          </Alert>
        )}
        <Button type="submit" variant="contained" size="large" disableElevation disabled={busy}>
          {t('auth.change')}
        </Button>
      </Box>
    </Card>
  );
}
