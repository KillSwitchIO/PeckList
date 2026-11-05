import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { fakeWebAuthn, noWebAuthn } from '../../test/fakeWebAuthn.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});
afterEach(() => noWebAuthn());

async function settingsAs(backend: FakeBackend, username: string, path = '/settings/account') {
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
  return screen.findByRole('region', { name: 'Passkeys' });
}

const pixel = {
  id: 'cred-0',
  name: 'Pixel',
  createdAt: '2026-11-01T09:00:00Z',
  lastUsedAt: null,
  synced: true,
};

describe('settings: passkeys (PL-123)', () => {
  it('adds a passkey, names it, and renames and removes one', async () => {
    const backend = new FakeBackend();
    backend.passkeysOn = true;
    backend.addAccount('sam', 'a long enough password');
    const browser = fakeWebAuthn('cred-1');
    const section = await settingsAs(backend, 'sam');
    expect(within(section).getByText('No passkeys yet')).toBeInTheDocument();

    await userEvent.click(within(section).getByRole('button', { name: 'Add a passkey' }));
    expect(browser.create).toHaveBeenCalledOnce();
    const naming = await screen.findByRole('dialog', { name: 'Name this passkey' });
    await userEvent.clear(within(naming).getByLabelText('Name'));
    await userEvent.type(within(naming).getByLabelText('Name'), 'MacBook');
    await userEvent.click(within(naming).getByRole('button', { name: 'Save' }));
    expect(await within(section).findByText('MacBook')).toBeInTheDocument();
    expect(
      within(section).getByText('Passkey added. You can sign in with it from now on.'),
    ).toBeInTheDocument();
    expect(backend.passkeysOf('sam').map((each) => each.name)).toEqual(['MacBook']);

    await userEvent.click(within(section).getByRole('button', { name: 'Remove MacBook' }));
    expect(await within(section).findByText('No passkeys yet')).toBeInTheDocument();
  });

  it('does without the password once there is a passkey, and never removes the last way in', async () => {
    const backend = new FakeBackend();
    backend.passkeysOn = true;
    backend.addAccount('sam', 'a long enough password');
    backend.passkeys.set('cred-0', { username: 'sam', info: pixel });
    const section = await settingsAs(backend, 'sam');
    await userEvent.click(await within(section).findByRole('button', { name: 'Remove password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove your password?' });
    await userEvent.type(within(dialog).getByLabelText(/Current password/), 'not it');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove password' }));
    expect(await within(dialog).findByText('That is not your password.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText(/Current password/));
    await userEvent.type(
      within(dialog).getByLabelText(/Current password/),
      'a long enough password',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove password' }));
    await waitFor(() =>
      expect(within(section).queryByText('With a passkey you can do without it.')).toBeNull(),
    );
    expect(backend.accounts.get('sam')?.password).toBe('');

    await userEvent.click(within(section).getByRole('button', { name: 'Remove Pixel' }));
    expect(
      await within(section).findByText(
        'This is your only way to sign in. Link another account first.',
      ),
    ).toBeInTheDocument();
    expect(within(section).getByText('Pixel')).toBeInTheDocument();
  });

  it('says a passkey from the app was added when it comes back', async () => {
    const backend = new FakeBackend();
    backend.passkeysOn = true;
    backend.addAccount('sam', 'a long enough password');
    backend.passkeys.set('cred-0', { username: 'sam', info: pixel });
    const section = await settingsAs(backend, 'sam', '/settings?link=passkey_added');
    expect(
      within(section).getByText('Passkey added. You can sign in with it from now on.'),
    ).toBeInTheDocument();
  });
});
