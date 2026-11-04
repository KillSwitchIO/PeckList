import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createTask } from '../../core/tasks.ts';
import { createSyncEngine } from './syncEngine.ts';

const leaveFor = vi.hoisted(() => vi.fn());
vi.mock('./signInWith.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./signInWith.ts')>()),
  leaveFor,
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
  return { ...result, store, sync, transport };
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

  it("draws Google's own button for the Google preset (PL-124)", async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'google', displayName: 'Google', preset: 'google' }],
      localLogin: true,
    };
    await serverApp(backend);
    const google = await screen.findByRole('link', { name: 'Continue with Google' });
    expect(google).toHaveAttribute('href', expect.stringMatching(/^\/auth\/oidc\/google\/login/));
    expect(google.querySelector('svg path[fill="#4285F4"]')).not.toBeNull();
  });

  it('shows no password form when the server turns passwords off, whatever the address says', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: false,
    };
    await serverApp(backend);
    await screen.findByRole('link', { name: 'Continue with Pocket ID' });
    expect(screen.queryByLabelText(/Username/)).toBeNull();
    cleanup();

    // `/login?local` used to bring the form back for admins; passwords are off now, so it does not.
    window.history.replaceState(null, '', '/login?local');
    await serverApp(backend);
    await screen.findByRole('link', { name: 'Continue with Pocket ID' });
    expect(screen.queryByLabelText(/Username/)).toBeNull();
  });

  it('when a provider session runs out, goes straight back through that provider', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: true,
    };
    localStorage.setItem('pecklist.signInWith', 'pocket');
    leaveFor.mockClear();
    window.history.replaceState(null, '', '/today');
    await serverApp(backend);
    expect(await screen.findByText('Continuing with Pocket ID')).toBeInTheDocument();
    expect(leaveFor).toHaveBeenCalledWith('/auth/oidc/pocket/login?returnUrl=%2Ftoday');
  });

  it('back again signed out within a minute, stays on the page instead of looping', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: true,
    };
    localStorage.setItem('pecklist.signInWith', 'pocket');
    sessionStorage.setItem('pecklist.signInWith.autoAt', String(Date.now() - 5_000));
    leaveFor.mockClear();
    window.history.replaceState(null, '', '/today');
    await serverApp(backend);
    expect(
      await screen.findByRole('link', { name: 'Continue with Pocket ID' }),
    ).toBeInTheDocument();
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it('a refused sign-in forgets the provider instead of looping', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: true,
    };
    localStorage.setItem('pecklist.signInWith', 'pocket');
    leaveFor.mockClear();
    window.history.replaceState(null, '', '/login?error=oidc_not_allowed');
    await serverApp(backend);
    expect(
      await screen.findByRole('link', { name: 'Continue with Pocket ID' }),
    ).toBeInTheDocument();
    expect(leaveFor).not.toHaveBeenCalled();
    expect(localStorage.getItem('pecklist.signInWith')).toBeNull();
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
    expect(await screen.findByRole('heading', { name: 'Sign in to PeckList' })).toBeInTheDocument();

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
    await userEvent.type(screen.getByLabelText(/New password/), 'short');
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'short{Enter}');
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/New password/));
    await userEvent.type(screen.getByLabelText(/New password/), 'a brand new password');
    // Typed twice, and the two must match.
    await userEvent.clear(screen.getByLabelText(/Confirm new password/));
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'a brand new passwrod');
    expect(screen.getByText("The new passwords don't match.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Confirm new password/), '{Enter}');
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    // The eye shows what was typed, and hides it again.
    const confirm = screen.getByLabelText(/Confirm new password/);
    expect(confirm).toHaveAttribute('type', 'password');
    const eyes = screen.getAllByRole('button', { name: 'Show password' });
    expect(eyes).toHaveLength(3);
    await userEvent.click(eyes[2]!);
    expect(confirm).toHaveAttribute('type', 'text');
    expect(confirm).toHaveValue('a brand new passwrod');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(confirm).toHaveAttribute('type', 'password');
    await userEvent.clear(confirm);
    await userEvent.type(confirm, 'a brand new password{Enter}');
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
    await userEvent.type(screen.getByLabelText(/New password/), 'a brand new password');
    await userEvent.type(
      screen.getByLabelText(/Confirm new password/),
      'a brand new password{Enter}',
    );
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
    backend.signOutRedirect = 'https://id.example.com/logout?client_id=pecklist';
    await serverApp(backend, 'ben');
    await userEvent.click(await screen.findByRole('button', { name: /^Account: / }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));
    await waitFor(() =>
      expect(leaveFor).toHaveBeenCalledWith('https://id.example.com/logout?client_id=pecklist'),
    );
  });

  it('Settings > Profile opens the profile photo, ready to pick a picture', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await serverApp(backend, 'ben');
    await userEvent.click(await screen.findByRole('button', { name: /^Account: / }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    // Settings loads on first visit: room for a busy CI runner.
    const profile = await screen.findByRole('region', { name: 'Profile' }, { timeout: 10_000 });
    await userEvent.click(within(profile).getByRole('button', { name: 'Choose a photo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Profile photo' });
    expect(within(dialog).getByRole('button', { name: 'Choose a photo' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Choose a photo')).toHaveAttribute('accept', 'image/*');
  });

  it('the cloud says how syncing stands; the profile menu logs out', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    // Already signed in: straight to the app, then the first sync.
    await serverApp(backend, 'ben');
    const cloud = await screen.findByRole('button', { name: /^Sync: Synced/ });
    await userEvent.click(cloud);
    const syncMenu = await screen.findByRole('menu');
    expect(within(syncMenu).getByText('Signed in as ben')).toBeInTheDocument();
    expect(within(syncMenu).queryByRole('menuitem', { name: 'Log out' })).toBeNull();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: /^Account: / }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('@ben')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Stats' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Friends and groups' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Keyboard shortcuts' }));
    expect(await screen.findByRole('dialog', { name: /shortcuts/i })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: /^Account: / }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to PeckList' })).toBeInTheDocument();
  });

  it('logging out with changes the server has not taken asks first, then clears the device', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store, transport } = await serverApp(backend, 'ben');
    await screen.findByRole('button', { name: /^Sync: Synced/ });
    transport.offline = true;
    store.getState().apply((ctx, ws) => {
      const inbox = ws.entities.lists.find((list) => list.isInbox)!.id;
      return createTask(ctx, ws, { title: 'Written on the train', listId: inbox }).workspace;
    });
    const titles = () => store.getState().workspace!.entities.tasks.map((task) => task.title);

    await userEvent.click(screen.getByRole('button', { name: /^Account: / }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));
    const ask = await screen.findByRole('dialog');
    expect(within(ask).getByText(/Changes not on the server yet: 1/)).toBeInTheDocument();
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(titles()).toEqual(['Written on the train']);

    await userEvent.click(screen.getByRole('button', { name: /^Account: / }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Log out anyway' }));
    await waitFor(() => expect(titles()).toEqual([]));
  });

  it('a first sign-in asks before the tasks already on the device join the account', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await serverApp(backend);
    await screen.findByRole('heading', { name: 'Sign in to PeckList' });
    // Someone else's standalone tasks on this computer.
    store.getState().apply((ctx, ws) => {
      const inbox = ws.entities.lists.find((list) => list.isInbox)!.id;
      return createTask(ctx, ws, { title: "A stranger's diary", listId: inbox }).workspace;
    });
    await userEvent.type(screen.getByLabelText(/Username/), 'ben');
    await userEvent.type(screen.getByLabelText(/^Password/), 'correct horse battery{Enter}');

    await screen.findByRole('heading', { name: 'Tasks already on this device' });
    expect(backend.server.rows.size).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Leave them out' }));
    await screen.findByRole('button', { name: /^Sync: Synced/ });
    expect(store.getState().workspace!.entities.tasks).toEqual([]);
    expect(backend.server.rows.size).toBeGreaterThan(0);
  });

  it('shows no cloud without a server', async () => {
    await renderApp('/today');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Sync/ })).toBeNull());
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
    await screen.findByRole('heading', { name: 'Sign in to PeckList' });
    expect(screen.queryByRole('button', { name: 'Create an account' })).toBeNull();
    cleanup();

    window.history.replaceState(null, '', '/signup');
    await serverApp(backend);
    expect(await screen.findByText(/by invite only/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Username/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to PeckList' })).toBeInTheDocument();
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

describe('a forgotten password (PL-122)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('offers the reset link only when the server sends them', async () => {
    const backend = new FakeBackend();
    await serverApp(backend);
    await screen.findByLabelText(/Username/);
    expect(screen.queryByRole('button', { name: 'Forgot your password?' })).toBeNull();
    cleanup();
    backend.passwordReset = true;
    await serverApp(backend);
    expect(
      await screen.findByRole('button', { name: 'Forgot your password?' }),
    ).toBeInTheDocument();
  });

  it('asks for a link, then sets a new password through it and signs in', async () => {
    const backend = new FakeBackend();
    backend.passwordReset = true;
    backend.addAccount('sam', 'the old password');
    backend.emails.set('sam', { email: 'sam@example.com', confirmed: true });
    await serverApp(backend);
    await userEvent.click(await screen.findByRole('button', { name: 'Forgot your password?' }));
    expect(window.location.pathname).toBe('/forgot');
    await userEvent.type(screen.getByLabelText(/Username or email/), 'sam@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByText('Look in your email')).toBeInTheDocument();
    expect(backend.sentMail).toEqual([{ to: 'sam@example.com', kind: 'reset' }]);
    cleanup();

    window.history.replaceState(null, '', '/reset/reset-sam');
    await serverApp(backend);
    expect(await screen.findByText(/^For sam\./)).toBeInTheDocument();
    const [first, second] = screen.getAllByLabelText(/New password/);
    await userEvent.type(first!, 'a brand new password');
    await userEvent.type(second!, 'a different password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    expect(await screen.findByText("The new passwords don't match.")).toBeInTheDocument();
    await userEvent.clear(second!);
    await userEvent.type(second!, 'a brand new password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    await waitFor(() => expect(screen.queryByText(/^For sam\./)).toBeNull());
    expect(backend.accounts.get('sam')?.password).toBe('a brand new password');
    expect(backend.resetLinks.size).toBe(0);
    expect(window.location.pathname).not.toMatch(/^\/reset/);
  });

  it('says when a link no longer works, and offers a new one', async () => {
    const backend = new FakeBackend();
    backend.passwordReset = true;
    window.history.replaceState(null, '', '/reset/spent');
    await serverApp(backend);
    expect(await screen.findByText('This link no longer works')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ask for a new link' }));
    expect(await screen.findByRole('button', { name: 'Send the link' })).toBeInTheDocument();
  });
});
