import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const slow = { timeout: 10_000 };

async function signedIn(backend: FakeBackend) {
  const store = testStore();
  const transport = backend.device();
  transport.session = 'ben';
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  return renderApp('/settings', store, sync);
}

describe('API keys (R-FB-157)', () => {
  it('makes a key with a name, expiry and permissions, shows it once, and revokes it', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await signedIn(backend);
    await userEvent.click(await screen.findByRole('link', { name: /API keys/ }, slow));
    await userEvent.click(await screen.findByRole('button', { name: 'New key' }, slow));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Home Assistant');
    // Changing tasks brings reading them; admin is for admins only.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Change tasks/ }));
    expect(within(dialog).getByRole('checkbox', { name: /Read tasks/ })).toBeChecked();
    expect(within(dialog).queryByRole('checkbox', { name: /^Admin/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

    const shown = await screen.findByRole('textbox', { name: 'API key' });
    expect(shown).toHaveValue('pl_k1_secretsecret');
    expect(screen.getByText(/shown only this once/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    const list = await screen.findByRole('list', { name: 'API keys' });
    const row = await within(list).findByText('Home Assistant');
    expect(within(list).getByText('Read tasks, Change tasks')).toBeInTheDocument();
    expect(within(list).getByText(/expires/)).toBeInTheDocument();
    expect(row).toBeInTheDocument();
    expect(backend.apiKeys.get('ben')![0]!.scopes).toEqual(['tasks:read', 'tasks:write']);

    await userEvent.click(within(list).getByRole('button', { name: 'Revoke Home Assistant' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(within(list).getByText(/revoked/)).toBeInTheDocument());
    expect(within(list).queryByRole('button', { name: 'Revoke Home Assistant' })).toBeNull();
  });
});
