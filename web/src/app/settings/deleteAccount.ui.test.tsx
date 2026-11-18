import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { FakeShell } from '../../test/fakeShell.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { setNativeShell } from '../native/shell.ts';
import { rememberProvider, rememberedProvider } from '../sync/signInWith.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';

const leaveFor = vi.hoisted(() => vi.fn());
vi.mock('../sync/signInWith.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/signInWith.ts')>()),
  leaveFor,
}));

// These run in a browser unless a test says otherwise; since 0.13.0 every build shows both.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  leaveFor.mockReset();
  mockViewport('desktop');
});

/** Every build: the Google Play app, the foss app and an older app (a browser is the default). */
const apps = [
  ['the Google Play app', () => new FakeShell(9, 'play')],
  ['the foss app', () => new FakeShell(9, 'foss')],
  ['an older app', () => new FakeShell(8)],
] as const;
afterEach(() => setNativeShell(null));

const slow = { timeout: 10_000 };

async function appAs(backend: FakeBackend, username: string | null, path = '/settings/account') {
  const store = testStore();
  const transport = backend.device();
  transport.session = username;
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await renderApp(path, store, sync);
  return { sync, transport };
}

const pocket = {
  provider: 'pocket',
  displayName: 'Pocket ID',
  subject: 'kim-sub',
  email: 'kim@example.com',
  linkedAt: '2026-10-22T08:00:00Z',
  lastUsedAt: '2026-10-22T08:00:00Z',
};

/** Kim signs in through Pocket ID only, and has no password. */
function kimsServer() {
  const backend = new FakeBackend();
  backend.signIn = { providers: [{ name: 'pocket', displayName: 'Pocket ID' }], localLogin: true };
  backend.addAccount('kim', '');
  backend.identities.set('kim', [pocket]);
  return backend;
}

async function openDialog() {
  const section = await screen.findByRole(
    'region',
    { name: 'Start over or delete your account' },
    slow,
  );
  await userEvent.click(within(section).getByRole('button', { name: 'Delete account' }));
  return screen.findByRole('dialog', { name: 'Delete your account?' });
}

describe('delete my account', () => {
  it('with the password: says what happens, refuses a wrong one, then signs out and says so', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    const { sync } = await appAs(backend, 'sam');
    const dialog = await openDialog();
    expect(
      within(dialog).getByText(
        /After 7 days it is removed for good.*an admin of this server can restore it/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/A list or group you share goes to the next person in it/),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Delete my account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Your password/), 'not it');
    await userEvent.click(confirm);
    expect(await within(dialog).findByText('That password is not right.')).toBeInTheDocument();
    expect(backend.deleted.has('sam')).toBe(false);

    await userEvent.clear(within(dialog).getByLabelText(/Your password/));
    await userEvent.type(within(dialog).getByLabelText(/Your password/), 'a long enough password');
    await userEvent.click(confirm);
    await waitFor(() => expect(sync.getState().phase).toBe('signed-out'), slow);
    expect(backend.deleted.has('sam')).toBe(true);
    expect(
      await screen.findByText(
        /Your account is deleted\. An admin of this server can restore it until .*2026/,
      ),
    ).toBeInTheDocument();
    // The project's privacy policy is on the sign-in page.
    expect(screen.getByRole('link', { name: 'PeckList privacy policy' })).toHaveAttribute(
      'href',
      'https://docs.pecklist.com/privacy-policy/',
    );
  });

  it('locked by too many wrong passwords: says until when, and deletes nothing', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    backend.lockedUntil = '2026-11-18T03:30:00Z';
    await appAs(backend, 'sam');
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText(/Your password/), 'a long enough password');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
    const time = new Date('2026-11-18T03:30:00Z').toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(
      await within(dialog).findByText(`Too many tries. This account is locked until ${time}.`),
    ).toBeInTheDocument();
    expect(backend.deleted.has('sam')).toBe(false);
  });

  it('with no grace period, says it goes at once and cannot be restored', async () => {
    const backend = new FakeBackend();
    backend.deleteGraceDays = 0;
    backend.addAccount('sam', 'a long enough password');
    const { sync } = await appAs(backend, 'sam');
    const dialog = await openDialog();
    expect(
      within(dialog).getByText(/Your account is removed now, for good.*It cannot be restored\./),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Your password/), 'a long enough password');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(sync.getState().phase).toBe('signed-out'), slow);
    expect(await screen.findByText('Your account is deleted.')).toBeInTheDocument();
  });

  it('the last super admin is told to make someone else one first, with no way to go on', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password', { role: 'superadmin' });
    await appAs(backend, 'sam');
    const dialog = await openDialog();
    expect(
      await within(dialog).findByText(
        /You are the last super admin here\. Make someone else a super admin first/,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Your password/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Delete my account' })).toBeNull();
  });

  it('without a password: a fresh sign-in through its provider first, coming back to the dialog', async () => {
    await appAs(kimsServer(), 'kim');
    const dialog = await openDialog();
    expect(
      await within(dialog).findByText(
        'To show it is you, sign in again, then delete within 10 minutes.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Delete my account' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign in with Pocket ID' }));
    expect(leaveFor).toHaveBeenCalledWith(
      '/auth/oidc/pocket/login?fresh=1&returnUrl=%2Fsettings%2Faccount%3Fdelete%3D1',
    );
  });

  it('back from a sign-in that still is not recent: says it did not count, and how else', async () => {
    await appAs(kimsServer(), 'kim', '/settings/account?delete=1');
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' }, slow);
    expect(
      await within(dialog).findByText(/That sign-in did not count.*ask an admin of this server/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Sign in with Pocket ID' }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Delete my account' })).toBeNull();
  });

  it('a passkey account is offered a passkey sign-in', async () => {
    const backend = kimsServer();
    backend.identities.set('kim', []);
    backend.passkeysOn = true;
    backend.passkeys.set('k1', {
      username: 'kim',
      info: {
        id: 'k1',
        name: 'Phone',
        createdAt: '2026-11-01T08:00:00Z',
        lastUsedAt: null,
        synced: true,
      },
    });
    await appAs(backend, 'kim');
    const dialog = await openDialog();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Sign in with a passkey' }),
    );
    expect(leaveFor).toHaveBeenCalledWith(
      '/auth/oidc/passkey/login?fresh=1&returnUrl=%2Fsettings%2Faccount%3Fdelete%3D1',
    );
  });

  it('back from that sign-in, the dialog opens by itself and deletes with no password', async () => {
    const backend = kimsServer();
    backend.signedInRecently.set('kim', true);
    rememberProvider('pocket');
    const { sync } = await appAs(backend, 'kim', '/settings/account?delete=1');
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' }, slow);
    expect(within(dialog).queryByLabelText(/Your password/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(sync.getState().phase).toBe('signed-out'), slow);
    expect(backend.deleted.has('kim')).toBe(true);
    // The sign-in page does not go straight back through Pocket ID for an account that is gone.
    expect(rememberedProvider()).toBeNull();
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it.each(apps)('%s shows it too', async (_name, shell) => {
    setNativeShell(shell());
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    await appAs(backend, 'sam');
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText(/Your password/)).toBeInTheDocument();
  });

  it('a server from before self-delete and Start over shows no such section', async () => {
    const backend = new FakeBackend();
    backend.deleteGraceDays = null;
    backend.startOverOffered = false;
    backend.addAccount('sam', 'a long enough password');
    await appAs(backend, 'sam');
    await screen.findByRole('region', { name: 'Email' }, slow);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('region', { name: 'Start over or delete your account' })).toBeNull();
  });
});

describe('the privacy policy', () => {
  it('is linked from Settings > Your data', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    await appAs(backend, 'sam', '/settings/data');
    const section = await screen.findByRole('region', { name: 'Privacy' }, slow);
    expect(within(section).getByRole('link', { name: /PeckList privacy policy/ })).toHaveAttribute(
      'href',
      'https://docs.pecklist.com/privacy-policy/',
    );
  });

  it('is linked under the sign-in card', async () => {
    await appAs(new FakeBackend(), null, '/login');
    expect(
      await screen.findByRole('link', { name: 'PeckList privacy policy' }, slow),
    ).toHaveAttribute('href', 'https://docs.pecklist.com/privacy-policy/');
  });

  it.each(apps)('%s: in Settings and on the sign-in page too', async (_name, shell) => {
    setNativeShell(shell());
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    await appAs(backend, 'sam', '/settings/data');
    const section = await screen.findByRole('region', { name: 'Privacy' }, slow);
    expect(
      within(section).getByRole('link', { name: /PeckList privacy policy/ }),
    ).toBeInTheDocument();
    cleanup();

    await appAs(new FakeBackend(), null, '/login');
    expect(
      await screen.findByRole('link', { name: 'PeckList privacy policy' }, slow),
    ).toBeInTheDocument();
  });
});
