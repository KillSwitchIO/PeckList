import { Alert, Box, Button, Divider, Link, Paper, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { SyncFailure, type SignInOptions, type SignUpOutcome } from '../../ports/sync.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';
import {
  leaveFor,
  mayContinueOnItsOwn,
  rememberedProvider,
  rememberProvider,
} from './signInWith.ts';
import { useSyncState } from './syncContext.ts';

type Entry = { page: 'sign-in' } | { page: 'sign-up' } | { page: 'join'; invite: string };

/** Which page the address asks for: `/join/<invite>`, `/signup`, else signing in. */
function entryOf(pathname: string): Entry {
  const join = /^\/join\/([^/]+)\/?$/.exec(pathname);
  if (join?.[1]) return { page: 'join', invite: decodeURIComponent(join[1]) };
  return pathname === '/signup' ? { page: 'sign-up' } : { page: 'sign-in' };
}

/** The page a server shows before the app: sign in, make an account, or replace a given password. */
export function AuthPages({ phase }: { phase: 'signed-out' | 'password-change' }) {
  const [entry, setEntry] = useState(() => entryOf(window.location.pathname));
  useEffect(() => {
    const onBack = () => setEntry(entryOf(window.location.pathname));
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);
  if (phase === 'password-change') return <ChangePassword />;
  const go = (path: '/login' | '/signup') => {
    window.history.pushState(null, '', path);
    setEntry(entryOf(path));
  };
  if (entry.page === 'join') return <SignUp invite={entry.invite} onSignIn={() => go('/login')} />;
  if (entry.page === 'sign-up') return <SignUp onSignIn={() => go('/login')} />;
  return <SignIn onSignUp={() => go('/signup')} />;
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

const OIDC_ERRORS = [
  'oidc_not_allowed',
  'oidc_pending',
  'oidc_disabled',
  'oidc_failed',
  'link_expired',
] as const;
type OidcError = (typeof OIDC_ERRORS)[number];
const isOidcError = (error: string | null): error is OidcError =>
  OIDC_ERRORS.some((each) => each === error);

/**
 * Why an identity provider sign-in came back to `/login?error=...`, read once; the address goes
 * back to `/` so a later sign-in does not land on it.
 */
function takeSignInError(): string | null {
  if (window.location.pathname !== '/login') return null;
  const error = new URLSearchParams(window.location.search).get('error');
  if (error === null) return null;
  window.history.replaceState(window.history.state, '', '/');
  // Refused: do not send them straight back to the same provider.
  rememberProvider(null);
  return isOidcError(error) ? t(`auth.oidc.${error}`) : null;
}

const PASSWORDS_ONLY: SignInOptions = { providers: [], localLogin: true };

/** Where to come back to after a provider's sign-in: here, unless here is the sign-in page. */
function returnUrl(): string {
  const { pathname, search } = window.location;
  return pathname === '/login' ? '/' : pathname + search;
}

/** Ways in, from the server; null while asking. Transports without providers: passwords only. */
function useSignInOptions(invite?: string): SignInOptions | null {
  const transport = useSyncState((state) => state.transport);
  const [options, setOptions] = useState<SignInOptions | null>(() =>
    transport.signInOptions ? null : PASSWORDS_ONLY,
  );
  useEffect(() => {
    let live = true;
    transport.signInOptions?.(returnUrl(), invite).then(
      (answer) => live && setOptions(answer),
      () => live && setOptions(PASSWORDS_ONLY),
    );
    return () => {
      live = false;
    };
  }, [transport, invite]);
  return options;
}

/** A provider's icon on its button; gone when the provider has none. */
function ProviderIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Box
      component="img"
      src={src}
      alt=""
      onError={() => setFailed(true)}
      sx={{ width: 20, height: 20, objectFit: 'contain' }}
    />
  );
}

/** One "Continue with ..." button per identity provider. */
function ProviderButtons({
  providers,
  onPick,
}: {
  providers: SignInOptions['providers'];
  onPick?: (name: string) => void;
}) {
  return providers.map((provider) => (
    <Button
      key={provider.name}
      variant="outlined"
      size="large"
      href={provider.url}
      onClick={() => onPick?.(provider.name)}
      startIcon={provider.icon ? <ProviderIcon src={provider.icon} /> : undefined}
      sx={{ textTransform: 'none' }}
    >
      {t('auth.with', { name: provider.displayName })}
    </Button>
  ));
}

/** "New here? Create an account" and its opposite, under a form. */
function SwitchLine({
  text,
  action,
  onClick,
}: {
  text: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 2.5, textAlign: 'center' }}>
      {text}{' '}
      <Link component="button" type="button" variant="body2" onClick={onClick}>
        {action}
      </Link>
    </Typography>
  );
}

function SignIn({ onSignUp }: { onSignUp: () => void }) {
  const signIn = useSyncState((state) => state.signIn);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useSignInOptions();
  // `/login?local` always shows the password form, for the admin when it is hidden.
  const [forceLocal] = useState(() => new URLSearchParams(window.location.search).has('local'));
  const [problem, setProblem] = useState<string | null>(takeSignInError);
  // Read after the error: a refused sign-in has forgotten it.
  const [remembered] = useState(rememberedProvider);

  const providers = options?.providers ?? [];
  const showForm = options !== null && (options.localLogin || forceLocal);
  // Signed in with a provider before and its session ran out: straight back through it.
  const continueWith = forceLocal ? undefined : providers.find((each) => each.name === remembered);
  // Decided once per page (a ref survives StrictMode's second effect run): go, or, when the last
  // trip came straight back within a minute, stay and show the buttons rather than loop.
  const goOnItsOwn = useRef<boolean | null>(null);
  const [heldBack, setHeldBack] = useState(false);
  useEffect(() => {
    if (!continueWith) return;
    goOnItsOwn.current ??= mayContinueOnItsOwn();
    if (goOnItsOwn.current) leaveFor(continueWith.url);
    else setHeldBack(true);
  }, [continueWith]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      rememberProvider(null);
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

  if (continueWith && !heldBack) {
    return (
      <Card
        title={t('auth.title')}
        subtitle={t('auth.continuing', { name: continueWith.displayName })}
      >
        {null}
      </Card>
    );
  }

  return (
    <Card title={t('auth.title')} subtitle={t('auth.subtitle')}>
      {providers.length > 0 && (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <ProviderButtons providers={providers} onPick={rememberProvider} />
          {!showForm && problem && (
            <Alert severity="error" variant="outlined">
              {problem}
            </Alert>
          )}
        </Box>
      )}
      {providers.length > 0 && showForm && (
        <Divider sx={{ my: 2.5, color: 'text.secondary', typography: 'body2' }}>
          {t('auth.or')}
        </Divider>
      )}
      {showForm && (
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
      )}
      {options?.registration === 'open' && options.localLogin && (
        <SwitchLine text={t('auth.newHere')} action={t('auth.createAccount')} onClick={onSignUp} />
      )}
    </Card>
  );
}

const SIGN_UP_PROBLEMS: Record<
  Exclude<SignUpOutcome['kind'], 'ok' | 'invite-invalid'>,
  MessageKey
> = {
  'username-taken': 'auth.signUp.taken',
  'invalid-username': 'auth.signUp.invalidUsername',
  'too-short': 'auth.tooShort',
  closed: 'auth.signUp.closed',
  'too-many': 'auth.tooMany',
};

/**
 * Making an account: with an invite link (`/join/<invite>`), or on a server open to anyone
 * (`/signup`). Identity providers are offered too; through an invite link, a new provider account
 * may come in on it.
 */
function SignUp({ invite, onSignIn }: { invite?: string; onSignIn: () => void }) {
  const signUp = useSyncState((state) => state.signUp);
  const transport = useSyncState((state) => state.transport);
  const options = useSignInOptions(invite);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Without an invite there is nothing to check; null while asking.
  const [inviteWorks, setInviteWorks] = useState<boolean | null>(() =>
    invite === undefined ? true : null,
  );

  useEffect(() => {
    if (invite === undefined) return;
    let live = true;
    const check = transport.checkInvite?.(invite) ?? Promise.resolve(null);
    check.then(
      (answer) => live && setInviteWorks(answer !== null),
      () => live && setInviteWorks(false),
    );
    return () => {
      live = false;
    };
  }, [transport, invite]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const before = window.location.pathname + window.location.search;
    try {
      // The router starts once this page goes away: at the app, not at this page's address.
      window.history.replaceState(null, '', '/');
      const outcome = await signUp(username, password, invite);
      if (outcome.kind === 'ok') return;
      window.history.replaceState(null, '', before);
      if (outcome.kind === 'invite-invalid') setInviteWorks(false);
      else setProblem(t(SIGN_UP_PROBLEMS[outcome.kind]));
    } catch (error) {
      window.history.replaceState(null, '', before);
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  const signInInstead = (
    <SwitchLine text={t('auth.haveAccount')} action={t('auth.signIn')} onClick={onSignIn} />
  );

  if (options === null || inviteWorks === null) {
    return (
      <Card title={t('auth.signUp.title')} subtitle={t('auth.signUp.checking')}>
        {null}
      </Card>
    );
  }
  if (!inviteWorks) {
    return (
      <Card title={t('auth.signUp.expiredTitle')} subtitle={t('auth.signUp.expired')}>
        {signInInstead}
      </Card>
    );
  }
  if (invite === undefined && options.registration !== 'open') {
    const why = options.registration === 'invite' ? 'auth.signUp.inviteOnly' : 'auth.signUp.closed';
    return (
      <Card title={t('auth.signUp.title')} subtitle={t(why)}>
        {signInInstead}
      </Card>
    );
  }

  const { providers } = options;
  return (
    <Card
      title={t('auth.signUp.title')}
      subtitle={t(invite === undefined ? 'auth.signUp.subtitle' : 'auth.signUp.invited')}
    >
      {providers.length > 0 && (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <ProviderButtons providers={providers} />
        </Box>
      )}
      {providers.length > 0 && options.localLogin && (
        <Divider sx={{ my: 2.5, color: 'text.secondary', typography: 'body2' }}>
          {t('auth.or')}
        </Divider>
      )}
      {options.localLogin && (
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
            helperText={t('auth.signUp.usernameHint')}
            slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false, maxLength: 32 } }}
          />
          <TextField
            label={t('auth.password')}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
            {busy ? t('auth.signUp.creating') : t('auth.signUp.create')}
          </Button>
        </Box>
      )}
      {signInInstead}
    </Card>
  );
}

function ChangePassword() {
  const changePassword = useSyncState((state) => state.changePassword);
  // The generated first password: once a super admin has chosen theirs, the setup wizard comes next.
  const superAdmin = useSyncState((state) => state.account?.role === 'superadmin');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const before = window.location.pathname + window.location.search;
      // The router starts once this page goes away: it opens at the wizard (which steps aside when
      // the server is already set up).
      if (superAdmin) window.history.replaceState(null, '', '/admin/setup');
      const outcome = await changePassword(current, next);
      if (outcome.kind !== 'ok' && superAdmin) window.history.replaceState(null, '', before);
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
