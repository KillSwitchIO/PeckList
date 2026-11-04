import KeyRounded from '@mui/icons-material/KeyRounded';
import { Box, Button, Divider, Link, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { messageOf } from '../../core/errors.ts';
import { SyncFailure, type SignInOptions, type SignUpOutcome } from '../../ports/sync.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';
import { CenteredCard } from '../layout/CenteredCard.tsx';
import { PasswordField } from '../layout/PasswordField.tsx';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { ConnectPage } from '../native/ConnectPage.tsx';
import { nativeShell } from '../native/shell.ts';
import {
  leaveFor,
  mayContinueOnItsOwn,
  rememberedProvider,
  rememberProvider,
} from './signInWith.ts';
import { passwordProblem, usePasswordDraft } from './passwordChange.ts';
import { PasswordChangeFields } from './PasswordChangeFields.tsx';
import { useSyncState } from './syncContext.ts';
import { autofillWorks, cancelled, createPasskey, getPasskey, passkeysWork } from './webauthn.ts';

type Entry =
  | { page: 'passkey-add'; token: string }
  | { page: 'sign-in' }
  | { page: 'sign-up' }
  | { page: 'join'; invite: string }
  | { page: 'forgot' }
  | { page: 'reset'; token: string };

/** Which page the address asks for: `/join/<invite>`, `/signup`, `/forgot`, `/reset/<token>`, else signing in. */
function entryOf(pathname: string): Entry {
  const join = /^\/join\/([^/]+)\/?$/.exec(pathname);
  if (join?.[1]) return { page: 'join', invite: decodeURIComponent(join[1]) };
  const reset = /^\/reset\/([^/]+)\/?$/.exec(pathname);
  if (reset?.[1]) return { page: 'reset', token: decodeURIComponent(reset[1]) };
  if (pathname === '/forgot') return { page: 'forgot' };
  if (pathname === '/passkey/add') {
    return {
      page: 'passkey-add',
      token: new URLSearchParams(window.location.search).get('token') ?? '',
    };
  }
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
  const go = (path: '/login' | '/signup' | '/forgot') => {
    window.history.pushState(null, '', path);
    setEntry(entryOf(path));
  };
  if (entry.page === 'join') return <SignUp invite={entry.invite} onSignIn={() => go('/login')} />;
  if (entry.page === 'sign-up') return <SignUp onSignIn={() => go('/login')} />;
  if (entry.page === 'forgot') return <Forgot onSignIn={() => go('/login')} />;
  if (entry.page === 'passkey-add') return <PasskeyEnroll token={entry.token} />;
  if (entry.page === 'reset') {
    return (
      <Reset token={entry.token} onSignIn={() => go('/login')} onAgain={() => go('/forgot')} />
    );
  }
  return <SignIn onSignUp={() => go('/signup')} onForgot={() => go('/forgot')} />;
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
  return messageOf(error);
}

const OIDC_ERRORS = [
  'oidc_not_allowed',
  'oidc_pending',
  'oidc_disabled',
  'oidc_failed',
  'link_expired',
  'app_sign_in_failed',
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
  return providers.map((provider) =>
    provider.preset === 'google' ? (
      <GoogleButton
        key={provider.name}
        href={provider.url}
        onClick={() => onPick?.(provider.name)}
      />
    ) : (
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
    ),
  );
}

/** Google's "G", in its own colors, as its sign-in branding asks. */
const GOOGLE_G = (
  <Box component="svg" viewBox="0 0 48 48" aria-hidden sx={{ width: 18, height: 18 }}>
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </Box>
);

/**
 * Google's own sign-in button (PL-124): its colors, its "G" and its words, light and dark, as
 * Google's branding guidelines ask of an app that offers its sign-in.
 */
function GoogleButton({ href, onClick }: { href: string; onClick: () => void }) {
  return (
    <Button
      href={href}
      onClick={onClick}
      size="large"
      startIcon={GOOGLE_G}
      sx={(theme) => ({
        textTransform: 'none',
        fontFamily: 'Roboto, Arial, sans-serif',
        fontWeight: 500,
        border: '1px solid',
        ...(theme.palette.mode === 'dark'
          ? {
              bgcolor: '#131314',
              color: '#E3E3E3',
              borderColor: '#8E918F',
              '&:hover': { bgcolor: '#2b2b2c' },
            }
          : {
              bgcolor: '#FFFFFF',
              color: '#1F1F1F',
              borderColor: '#747775',
              '&:hover': { bgcolor: '#f2f2f2' },
            }),
      })}
    >
      {t('auth.withGoogle')}
    </Button>
  );
}

/** The username and password fields, for signing in or (`newAccount`) making an account. */
function CredentialsFields({
  username,
  password,
  onUsername,
  onPassword,
  newAccount = false,
}: {
  username: string;
  password: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  newAccount?: boolean;
}) {
  return (
    <>
      <TextField
        label={t('auth.username')}
        value={username}
        onChange={(event) => onUsername(event.target.value)}
        autoComplete={newAccount ? 'username' : 'username webauthn'}
        autoFocus
        required
        {...(newAccount ? { helperText: t('auth.signUp.usernameHint') } : {})}
        slotProps={{
          htmlInput: {
            autoCapitalize: 'none',
            spellCheck: false,
            ...(newAccount ? { maxLength: 32 } : {}),
          },
        }}
      />
      <PasswordField
        label={t('auth.password')}
        value={password}
        onChange={(event) => onPassword(event.target.value)}
        autoComplete={newAccount ? 'new-password' : 'current-password'}
        {...(newAccount ? { helperText: t('auth.newHint') } : {})}
        required
      />
    </>
  );
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

/**
 * Where a passkey sign-in in a browser tab goes next: back to the Android app's hand-off
 * (`/login?passkey=1&returnUrl=/auth/app/handoff...`), or nowhere (the app itself loads).
 */
function handoffAfterPasskey(): string | null {
  if (window.location.pathname !== '/login') return null;
  const returnUrl = new URLSearchParams(window.location.search).get('returnUrl');
  return returnUrl?.startsWith('/auth/app/handoff?') ? returnUrl : null;
}

/**
 * Signing in with a passkey (PL-123). In the Android app the WebView has no WebAuthn, so the
 * button is a link the app turns into its browser hand-off; elsewhere the browser asks at once,
 * and the username field offers passkeys in its autofill too.
 */
function usePasskeySignIn(serverOffers: boolean, onProblem: (problem: string | null) => void) {
  const transport = useSyncState((state) => state.transport);
  const signIn = useSyncState((state) => state.signInWithPasskey);
  const [busy, setBusy] = useState(false);
  const autofill = useRef<AbortController | null>(null);
  const native = nativeShell() !== null;
  const offered = serverOffers && (native || passkeysWork());

  const finish = async (ceremony: string, credential: unknown) => {
    const next = handoffAfterPasskey();
    // The router starts once this page goes away: at the app, not at the sign-in page.
    if (!next) window.history.replaceState(null, '', '/');
    const outcome = await signIn(ceremony, credential);
    if (outcome.kind === 'ok') {
      if (next) leaveFor(next);
      return;
    }
    onProblem(t(outcome.kind === 'too-many' ? 'auth.tooMany' : 'auth.passkey.invalid'));
  };

  // Offered in the username field's autofill while the page is open.
  useEffect(() => {
    if (!offered || native || !transport.passkeySignInOptions) return;
    const controller = new AbortController();
    autofill.current = controller;
    void (async () => {
      if (!(await autofillWorks())) return;
      const started = await transport.passkeySignInOptions?.();
      if (!started || controller.signal.aborted) return;
      const credential = await getPasskey(started.options, {
        signal: controller.signal,
        autofill: true,
      });
      await finish(started.ceremony, credential);
    })().catch((error: unknown) => {
      if (!cancelled(error)) onProblem(problemOf(error));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page, as the server offers
  }, [offered, native, transport]);

  const start = async () => {
    if (native) return;
    autofill.current?.abort();
    setBusy(true);
    onProblem(null);
    try {
      const started = await transport.passkeySignInOptions?.();
      if (!started) {
        onProblem(t('auth.passkey.off'));
        return;
      }
      await finish(started.ceremony, await getPasskey(started.options));
    } catch (error) {
      if (!cancelled(error)) onProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };
  return { offered, busy, start: () => void start() };
}

/** "Sign in with a passkey": the browser's own prompt, or in the Android app a link to its hand-off. */
function PasskeyButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const native = nativeShell() !== null;
  return (
    <Button
      variant="outlined"
      size="large"
      startIcon={<KeyRounded />}
      disabled={busy}
      {...(native
        ? { href: `/auth/oidc/passkey/login?returnUrl=${encodeURIComponent(returnUrl())}` }
        : { onClick })}
      sx={{ textTransform: 'none' }}
    >
      {t('auth.passkey.signIn')}
    </Button>
  );
}

function SignIn({ onSignUp, onForgot }: { onSignUp: () => void; onForgot: () => void }) {
  const signIn = useSyncState((state) => state.signIn);
  // The Android app: maybe this is the wrong server (ADR-0017).
  const [connecting, setConnecting] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useSignInOptions();
  const [problem, setProblem] = useState<string | null>(takeSignInError);
  // Read after the error: a refused sign-in has forgotten it.
  const [remembered] = useState(rememberedProvider);

  const providers = options?.providers ?? [];
  const showForm = options !== null && options.localLogin;
  const passkeys = usePasskeySignIn(options?.passkeys === true, setProblem);
  // Signed in with a provider before and its session ran out: straight back through it.
  // Not in the Android app, where a provider opens in a browser tab: popping that up unasked on
  // start is jarring, so the buttons show instead.
  const continueWith = nativeShell()
    ? undefined
    : providers.find((each) => each.name === remembered);
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
      else if (outcome.kind === 'disabled') setProblem(t('auth.passwordsOff'));
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  if (connecting) return <ConnectPage onBack={() => setConnecting(false)} />;

  if (continueWith && !heldBack) {
    return (
      <CenteredCard
        title={t('auth.title')}
        subtitle={t('auth.continuing', { name: continueWith.displayName })}
      >
        {null}
      </CenteredCard>
    );
  }

  return (
    <CenteredCard title={t('auth.title')} subtitle={t('auth.subtitle')}>
      {(providers.length > 0 || passkeys.offered) && (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {passkeys.offered && <PasskeyButton busy={passkeys.busy} onClick={passkeys.start} />}
          <ProviderButtons providers={providers} onPick={rememberProvider} />
          {!showForm && <ProblemAlert problem={problem} />}
        </Box>
      )}
      {(providers.length > 0 || passkeys.offered) && showForm && (
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
          <CredentialsFields
            username={username}
            password={password}
            onUsername={setUsername}
            onPassword={setPassword}
          />
          <ProblemAlert problem={problem} />
          <Button type="submit" variant="contained" size="large" disableElevation disabled={busy}>
            {busy ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
          {options?.passwordReset && (
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={onForgot}
              sx={{ justifySelf: 'center' }}
            >
              {t('auth.forgot.link')}
            </Link>
          )}
        </Box>
      )}
      {options?.registration === 'open' && options.localLogin && (
        <SwitchLine text={t('auth.newHere')} action={t('auth.createAccount')} onClick={onSignUp} />
      )}
      {nativeShell() && (
        <SwitchLine
          text={t('auth.otherServer')}
          action={t('auth.changeServer')}
          onClick={() => setConnecting(true)}
        />
      )}
    </CenteredCard>
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
  'signup-limited': 'auth.signUp.limited',
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
      <CenteredCard title={t('auth.signUp.title')} subtitle={t('auth.signUp.checking')}>
        {null}
      </CenteredCard>
    );
  }
  if (!inviteWorks) {
    return (
      <CenteredCard title={t('auth.signUp.expiredTitle')} subtitle={t('auth.signUp.expired')}>
        {signInInstead}
      </CenteredCard>
    );
  }
  if (invite === undefined && options.registration !== 'open') {
    const why = options.registration === 'invite' ? 'auth.signUp.inviteOnly' : 'auth.signUp.closed';
    return (
      <CenteredCard title={t('auth.signUp.title')} subtitle={t(why)}>
        {signInInstead}
      </CenteredCard>
    );
  }

  const { providers } = options;
  return (
    <CenteredCard
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
          <CredentialsFields
            username={username}
            password={password}
            onUsername={setUsername}
            onPassword={setPassword}
            newAccount
          />
          <ProblemAlert problem={problem} />
          <Button type="submit" variant="contained" size="large" disableElevation disabled={busy}>
            {busy ? t('auth.signUp.creating') : t('auth.signUp.create')}
          </Button>
        </Box>
      )}
      {signInInstead}
    </CenteredCard>
  );
}

function ChangePassword() {
  const changePassword = useSyncState((state) => state.changePassword);
  // The generated first password: once a super admin has chosen theirs, the setup wizard comes next.
  const superAdmin = useSyncState((state) => state.account?.role === 'superadmin');
  const draft = usePasswordDraft();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (draft.again !== draft.next) {
      setProblem(t('auth.mismatch'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const before = window.location.pathname + window.location.search;
      // The router starts once this page goes away: it opens at the wizard (which steps aside when
      // the server is already set up).
      if (superAdmin) window.history.replaceState(null, '', '/admin/setup');
      const outcome = await changePassword(draft.current, draft.next);
      if (outcome.kind !== 'ok' && superAdmin) window.history.replaceState(null, '', before);
      setProblem(passwordProblem(outcome));
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredCard title={t('auth.changeTitle')} subtitle={t('auth.changeSubtitle')}>
      <Box
        component="form"
        onSubmit={(event) => void submit(event)}
        sx={{ display: 'grid', gap: 2 }}
      >
        <PasswordChangeFields draft={draft} />
        <ProblemAlert problem={problem} />
        <Button type="submit" variant="contained" size="large" disableElevation disabled={busy}>
          {t('auth.change')}
        </Button>
      </Box>
    </CenteredCard>
  );
}

/** "Forgot your password?" (PL-122): a username or email, and the same answer whoever it is. */
function Forgot({ onSignIn }: { onSignIn: () => void }) {
  const transport = useSyncState((state) => state.transport);
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!transport.forgotPassword) return;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await transport.forgotPassword(login.trim());
      if (answer === 'sent') setSent(true);
      else setProblem(t(answer === 'too-many' ? 'auth.tooMany' : 'auth.forgot.unavailable'));
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <SwitchLine text={t('auth.forgot.remembered')} action={t('auth.signIn')} onClick={onSignIn} />
  );
  if (sent) {
    return (
      <CenteredCard title={t('auth.forgot.sentTitle')} subtitle={t('auth.forgot.sent')}>
        {back}
      </CenteredCard>
    );
  }
  return (
    <CenteredCard title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')}>
      <Box
        component="form"
        onSubmit={(event) => void submit(event)}
        sx={{ display: 'grid', gap: 2 }}
      >
        <TextField
          label={t('auth.forgot.login')}
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          autoComplete="username"
          autoFocus
          required
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false, maxLength: 254 } }}
        />
        <ProblemAlert problem={problem} />
        <Button type="submit" variant="contained" size="large" disableElevation disabled={busy}>
          {t('auth.forgot.send')}
        </Button>
      </Box>
      {back}
    </CenteredCard>
  );
}

const RESET_PROBLEMS: Record<'too-short' | 'too-many' | 'demo', MessageKey> = {
  'too-short': 'auth.tooShort',
  'too-many': 'auth.tooMany',
  demo: 'auth.reset.demo',
};

/** A reset link (`/reset/<token>`): a new password, then straight in with it. */
function Reset({
  token,
  onSignIn,
  onAgain,
}: {
  token: string;
  onSignIn: () => void;
  onAgain: () => void;
}) {
  const transport = useSyncState((state) => state.transport);
  const signIn = useSyncState((state) => state.signIn);
  // Whose password this sets; null while asking, false when the link no longer works.
  const [username, setUsername] = useState<string | false | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const check = transport.checkResetLink?.(token) ?? Promise.resolve(null);
    check.then(
      (answer) => live && setUsername(answer ?? false),
      () => live && setUsername(false),
    );
    return () => {
      live = false;
    };
  }, [transport, token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!transport.resetPassword || !username) return;
    if (again !== password) {
      setProblem(t('auth.mismatch'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await transport.resetPassword(token, password);
      if (outcome.kind === 'expired') {
        setUsername(false);
        return;
      }
      if (outcome.kind !== 'ok') {
        setProblem(t(RESET_PROBLEMS[outcome.kind]));
        return;
      }
      // The router starts once this page goes away: at the app, not at the spent link.
      window.history.replaceState(null, '', '/');
      await signIn(outcome.username, password);
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  if (username === null) {
    return (
      <CenteredCard title={t('auth.reset.title')} subtitle={t('auth.signUp.checking')}>
        {null}
      </CenteredCard>
    );
  }
  if (username === false) {
    return (
      <CenteredCard title={t('auth.reset.expiredTitle')} subtitle={t('auth.reset.expired')}>
        <Button variant="contained" size="large" disableElevation onClick={onAgain} fullWidth>
          {t('auth.reset.again')}
        </Button>
        <SwitchLine
          text={t('auth.forgot.remembered')}
          action={t('auth.signIn')}
          onClick={onSignIn}
        />
      </CenteredCard>
    );
  }
  return (
    <CenteredCard
      title={t('auth.reset.title')}
      subtitle={t('auth.reset.subtitle', { name: username })}
    >
      <Box
        component="form"
        onSubmit={(event) => void submit(event)}
        sx={{ display: 'grid', gap: 2 }}
      >
        {/* For password managers: whose password this is. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          readOnly
          hidden
        />
        <PasswordField
          label={t('auth.reset.new')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          helperText={t('auth.newHint')}
          autoFocus
          required
        />
        <PasswordField
          label={t('auth.reset.repeat')}
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          autoComplete="new-password"
          required
        />
        <ProblemAlert problem={problem} />
        <Button type="submit" variant="contained" size="large" disableElevation disabled={busy}>
          {t('auth.reset.save')}
        </Button>
      </Box>
    </CenteredCard>
  );
}

/**
 * Adding a passkey from the Android app (PL-123): the app opens this page in a browser tab with a
 * token for the account (`/passkey/add?token=...`); once added, the tab goes back to the app.
 */
export function PasskeyEnroll({ token }: { token: string }) {
  const transport = useSyncState((state) => state.transport);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!transport.passkeyEnrollOptions || !transport.passkeyEnroll) return;
    setBusy(true);
    setProblem(null);
    try {
      const started = await transport.passkeyEnrollOptions(token);
      if (!started) {
        setExpired(true);
        return;
      }
      const credential = await createPasskey(started.options);
      const back = await transport.passkeyEnroll(token, started.ceremony, credential, name.trim());
      if (!back) {
        setExpired(true);
        return;
      }
      window.location.assign(back);
    } catch (error) {
      if (!cancelled(error)) setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  if (expired || !token) {
    return (
      <CenteredCard title={t('auth.passkey.addTitle')} subtitle={t('auth.passkey.addExpired')}>
        {null}
      </CenteredCard>
    );
  }
  return (
    <CenteredCard title={t('auth.passkey.addTitle')} subtitle={t('auth.passkey.addSubtitle')}>
      <Box
        component="form"
        onSubmit={(event) => void submit(event)}
        sx={{ display: 'grid', gap: 2 }}
      >
        <TextField
          label={t('settings.passkeys.name')}
          placeholder={t('settings.passkeys.namePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 60 } }}
        />
        <ProblemAlert problem={problem} />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disableElevation
          disabled={busy}
          startIcon={<KeyRounded />}
        >
          {t('auth.passkey.add')}
        </Button>
      </Box>
    </CenteredCard>
  );
}
