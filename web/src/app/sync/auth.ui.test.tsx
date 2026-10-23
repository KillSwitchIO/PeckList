import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from './syncEngine.ts';

const leaveFor = vi.hoisted(() => vi.fn());
vi.mock('./signInWith.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./signInWith.ts')>()),
  leaveFor,
}));

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function serverApp(backend: FakeBackend, signedInAs: string | null = null) {
  const store = testStore();
  const transport = backend.device();
  transport.session = signedInAs;
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  const result = await renderApp('/today', store, sync);
  return { ...result, sync, transport };
}

describe('signing in with an identity provider', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('offers each provider beside the password form', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: true,
    };
    window.history.replaceState(null, '', '/lists/abc');
    await serverApp(backend);
    const pocket = await screen.findByRole('link', { name: 'Continue with Pocket ID' });
    // Back to where the person was once the provider is done.
    expect(pocket).toHaveAttribute('href', '/auth/oidc/pocket/login?returnUrl=%2Flists%2Fabc');
    expect(screen.getByText('or')).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/)).toBeInTheDocument();
  });

  it('hides the password form when the server says so, unless the address asks for it', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: false,
    };
    await serverApp(backend);
    await screen.findByRole('link', { name: 'Continue with Pocket ID' });
    expect(screen.queryByLabelText(/Username/)).toBeNull();
    cleanup();

    window.history.replaceState(null, '', '/login?local');
    await serverApp(backend);
    expect(await screen.findByLabelText(/Username/)).toBeInTheDocument();
  });

  it('when a provider session runs out, goes straight back through that provider', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: true,
    };
    localStorage.setItem('punchlist.signInWith', 'pocket');
    leaveFor.mockClear();
    window.history.replaceState(null, '', '/today');
    await serverApp(backend);
    expect(await screen.findByText('Continuing with Pocket ID')).toBeInTheDocument();
    expect(leaveFor).toHaveBeenCalledWith('/auth/oidc/pocket/login?returnUrl=%2Ftoday');
  });

  it('a refused sign-in forgets the provider instead of looping', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: true,
    };
    localStorage.setItem('punchlist.signInWith', 'pocket');
    leaveFor.mockClear();
    window.history.replaceState(null, '', '/login?error=oidc_not_allowed');
    await serverApp(backend);
    expect(
      await screen.findByRole('link', { name: 'Continue with Pocket ID' }),
    ).toBeInTheDocument();
    expect(leaveFor).not.toHaveBeenCalled();
    expect(localStorage.getItem('punchlist.signInWith')).toBeNull();
  });

  it('explains why a provider sign-in came back, once', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: false,
    };
    window.history.replaceState(null, '', '/login?error=oidc_not_allowed');
    await serverApp(backend);
    expect(
      await screen.findByText(
        'Your account is not allowed on this server. Ask the admin to add you to the right group.',
      ),
    ).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe('/');
  });
});

describe('signing in to a server', () => {
  it('asks for a login, explains a wrong one, then opens the app', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await serverApp(backend);
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Punchlist' }),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Username/), 'ben');
    await userEvent.type(screen.getByLabelText(/^Password/), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That username and password do not match.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/^Password/));
    await userEvent.type(screen.getByLabelText(/^Password/), 'correct horse battery{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
  });

  it('a given password is replaced before anything else', async () => {
    const backend = new FakeBackend();
    backend.addAccount('admin', 'generated password', { mustChangePassword: true, role: 'admin' });
    await serverApp(backend);
    await userEvent.type(await screen.findByLabelText(/Username/), 'admin');
    await userEvent.type(screen.getByLabelText(/^Password/), 'generated password{Enter}');
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Current password/), 'generated password');
    await userEvent.type(screen.getByLabelText(/New password/), 'short{Enter}');
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/New password/));
    await userEvent.type(screen.getByLabelText(/New password/), 'a brand new password{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
  });

  it('the first super admin goes on to set up the server once their password is chosen', async () => {
    window.history.replaceState(null, '', '/today');
    const backend = new FakeBackend();
    backend.addAccount('admin', 'generated password', {
      mustChangePassword: true,
      role: 'superadmin',
    });
    await serverApp(backend);
    await userEvent.type(await screen.findByLabelText(/Username/), 'admin');
    await userEvent.type(screen.getByLabelText(/^Password/), 'generated password{Enter}');
    await screen.findByRole('heading', { name: 'Choose a new password' });

    // A wrong current password leaves the address alone.
    await userEvent.type(screen.getByLabelText(/Current password/), 'not it');
    await userEvent.type(screen.getByLabelText(/New password/), 'a brand new password{Enter}');
    expect(
      await screen.findByText(/current password/i, { selector: '.MuiAlert-message' }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/today');

    await userEvent.clear(screen.getByLabelText(/Current password/));
    await userEvent.type(screen.getByLabelText(/Current password/), 'generated password{Enter}');
    await waitFor(() => expect(window.location.pathname).toBe('/admin/setup'));
    window.history.replaceState(null, '', '/');
  });

  it('signing out of a provider session goes on to end it at the provider', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    backend.signOutRedirect = 'https://id.example.com/logout?client_id=punchlist';
    await serverApp(backend, 'ben');
    await userEvent.click(await screen.findByRole('button', { name: /^Sync and account/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith('https://id.example.com/logout?client_id=punchlist'),
    );
  });

  it('the cloud shows who is signed in, and signs out', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    // Already signed in: straight to the app, then the first sync.
    await serverApp(backend, 'ben');
    const cloud = await screen.findByRole('button', { name: /^Sync and account: Synced/ });
    await userEvent.click(cloud);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Signed in as ben')).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Punchlist' }),
    ).toBeInTheDocument();
  });

  it('shows no cloud without a server', async () => {
    await renderApp('/today');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Sync and account/ })).toBeNull(),
    );
  });
});

describe('making an account', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('an open server offers sign-up from the sign-in page and opens the app after', async () => {
    const backend = new FakeBackend();
    backend.signIn = { providers: [], localLogin: true, registration: 'open' };
    backend.addAccount('ben', 'correct horse battery');
    await serverApp(backend);
    await userEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
    expect(window.location.pathname).toBe('/signup');
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Username/), 'ben');
    await userEvent.type(screen.getByLabelText(/^Password/), 'a long enough password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('That username is taken. Try another.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/signup');

    await userEvent.clear(screen.getByLabelText(/Username/));
    await userEvent.type(screen.getByLabelText(/Username/), 'Sam{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(backend.accounts.get('sam')?.password).toBe('a long enough password');
  });

  it('an invite-only server shows no sign-up link, and /signup says to ask for an invite', async () => {
    const backend = new FakeBackend();
    backend.signIn = { providers: [], localLogin: true, registration: 'invite' };
    await serverApp(backend);
    await screen.findByRole('heading', { name: 'Sign in to Punchlist' });
    expect(screen.queryByRole('button', { name: 'Create an account' })).toBeNull();
    cleanup();

    window.history.replaceState(null, '', '/signup');
    await serverApp(backend);
    expect(await screen.findByText(/by invite only/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Username/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Punchlist' }),
    ).toBeInTheDocument();
  });

  it('an invite link lets someone in once, with a password or through a provider', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: true,
      registration: 'invite',
    };
    backend.invites.set('tok-1', 1);
    window.history.replaceState(null, '', '/join/tok-1');
    await serverApp(backend);
    expect(
      await screen.findByText('You were invited to this server. Pick a username and password.'),
    ).toBeInTheDocument();
    // A new provider account may come in on the invite too.
    expect(screen.getByRole('link', { name: 'Continue with Pocket ID' })).toHaveAttribute(
      'href',
      '/auth/oidc/pocket/login?returnUrl=%2Fjoin%2Ftok-1&invite=tok-1',
    );
    await userEvent.type(screen.getByLabelText(/Username/), 'kim');
    await userEvent.type(screen.getByLabelText(/^Password/), 'a long enough password{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    // The address leaves the invite behind.
    expect(window.location.pathname).toBe('/');
    cleanup();

    window.history.replaceState(null, '', '/join/tok-1');
    await serverApp(backend);
    expect(
      await screen.findByRole('heading', { name: 'This invite has run out' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Username/)).toBeNull();
  });
});
