import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createTask } from '../../core/tasks.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

const leaveFor = vi.hoisted(() => vi.fn());
vi.mock('../sync/signInWith.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/signInWith.ts')>()),
  leaveFor,
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  leaveFor.mockReset();
  mockViewport('desktop');
});

const slow = { timeout: 10_000 };
const SECTION = 'Start over or delete your account';

async function appAs(backend: FakeBackend, username: string, path = '/settings/account') {
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
  return { store, sync };
}

async function openDialog() {
  const section = await screen.findByRole('region', { name: SECTION }, slow);
  await userEvent.click(within(section).getByRole('button', { name: 'Start over' }));
  return screen.findByRole('dialog', { name: 'Start over?' });
}

/** Kim signs in through Pocket ID only, and has no password. */
function kimsServer() {
  const backend = new FakeBackend();
  backend.signIn = { providers: [{ name: 'pocket', displayName: 'Pocket ID' }], localLogin: true };
  backend.addAccount('kim', '');
  backend.identities.set('kim', [
    {
      provider: 'pocket',
      displayName: 'Pocket ID',
      subject: 'kim-sub',
      email: 'kim@example.com',
      linkedAt: '2026-10-22T08:00:00Z',
      lastUsedAt: '2026-10-22T08:00:00Z',
    },
  ]);
  return backend;
}

describe('start over', () => {
  it('sits with Delete my account in its own section at the bottom of Settings > Account', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    await appAs(backend, 'sam');
    const section = await screen.findByRole('region', { name: SECTION }, slow);
    expect(
      within(section).getByText(/keeps your account, its sign-in and your settings/),
    ).toBeInTheDocument();
    expect(
      await within(section).findByRole('button', { name: 'Delete account' }, slow),
    ).toBeInTheDocument();
    const regions = screen.getAllByRole('region');
    expect(regions[regions.length - 1]).toBe(section);
  });

  it('with the password and the phrase typed: erases their things, keeps the account, and this device starts over', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    const { store, sync } = await appAs(backend, 'sam');
    await screen.findByRole('button', { name: /^Sync: Synced/ }, slow);
    store.getState().apply((ctx, ws) => {
      const inbox = ws.entities.lists.find((list) => list.isInbox)!.id;
      return createTask(ctx, ws, { title: 'Old plans', listId: inbox }).workspace;
    });
    await sync.getState().syncNow();
    const live = () =>
      store
        .getState()
        .workspace!.entities.tasks.filter((task) => task.deletedAt === null)
        .map((task) => task.title);
    expect(live()).toEqual(['Old plans']);

    const dialog = await openDialog();
    expect(
      await within(dialog).findByText(
        /deleted from every device you use, and they can’t be brought back/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/A list you share goes to the next person in it/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download a copy' })).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Start over' });
    await userEvent.type(within(dialog).getByLabelText(/Your password/), 'not it');
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText(/Type "start over" to confirm/),
      'Start Over',
    );
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(await within(dialog).findByText('That password is not right.')).toBeInTheDocument();
    expect(backend.personEpochs.has('sam')).toBe(false);

    await userEvent.clear(within(dialog).getByLabelText(/Your password/));
    await userEvent.type(within(dialog).getByLabelText(/Your password/), 'a long enough password');
    await userEvent.click(confirm);
    expect(
      await screen.findByText(
        /You have started over\. Your account, its sign-in and your settings stay\./,
        {},
        slow,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(live()).toEqual([]), slow);
    // Still signed in, with an Inbox to start again in.
    expect(sync.getState().phase).toBe('ready');
    expect(
      store.getState().workspace!.entities.lists.some((list) => list.isInbox && !list.deletedAt),
    ).toBe(true);
  });

  it('locked by too many wrong passwords: says until when, and erases nothing', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    backend.lockedUntil = '2026-11-18T03:30:00Z';
    await appAs(backend, 'sam');
    const dialog = await openDialog();
    await userEvent.type(
      await within(dialog).findByLabelText(/Your password/),
      'a long enough password',
    );
    await userEvent.type(
      within(dialog).getByLabelText(/Type "start over" to confirm/),
      'start over',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start over' }));
    const time = new Date('2026-11-18T03:30:00Z').toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(
      await within(dialog).findByText(`Too many tries. This account is locked until ${time}.`),
    ).toBeInTheDocument();
    expect(backend.personEpochs.has('sam')).toBe(false);
  });

  it('without a password: a fresh sign-in first, coming back to the Start over dialog', async () => {
    await appAs(kimsServer(), 'kim');
    const dialog = await openDialog();
    expect(
      await within(dialog).findByText(
        'To show it is you, sign in again, then start over within 10 minutes.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Start over' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign in with Pocket ID' }));
    expect(leaveFor).toHaveBeenCalledWith(
      '/auth/oidc/pocket/login?fresh=1&returnUrl=%2Fsettings%2Faccount%3Fstartover%3D1',
    );
  });

  it('back from that sign-in, the dialog opens by itself and starts over with no password', async () => {
    const backend = kimsServer();
    backend.signedInRecently.set('kim', true);
    await appAs(backend, 'kim', '/settings/account?startover=1');
    const dialog = await screen.findByRole('dialog', { name: 'Start over?' }, slow);
    expect(within(dialog).queryByLabelText(/Your password/)).toBeNull();
    await userEvent.type(
      await within(dialog).findByLabelText(/Type "start over" to confirm/),
      'start over',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start over' }));
    expect(await screen.findByText(/You have started over/, {}, slow)).toBeInTheDocument();
    expect(backend.personEpochs.has('kim')).toBe(true);
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it('a server from before it shows only Delete my account, and the device-only Start over in Your data', async () => {
    const backend = new FakeBackend();
    backend.startOverOffered = false;
    backend.addAccount('sam', 'a long enough password');
    await appAs(backend, 'sam');
    const section = await screen.findByRole('region', { name: SECTION }, slow);
    expect(
      await within(section).findByRole('button', { name: 'Delete account' }, slow),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Start over' })).toBeNull();
  });

  it('Your data drops its device-only Start over where the server offers the real one', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    await appAs(backend, 'sam', '/settings/data');
    await screen.findByRole('region', { name: 'Privacy' }, slow);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Delete all lists, tasks and tags' })).toBeNull();
  });

  it('Your data keeps it on a server from before it', async () => {
    const backend = new FakeBackend();
    backend.startOverOffered = false;
    backend.addAccount('sam', 'a long enough password');
    await appAs(backend, 'sam', '/settings/data');
    expect(
      await screen.findByRole('button', { name: 'Delete all lists, tasks and tags' }, slow),
    ).toBeInTheDocument();
  });
});
