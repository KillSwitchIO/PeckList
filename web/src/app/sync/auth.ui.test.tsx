import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from './syncEngine.ts';

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
