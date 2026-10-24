import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('your stats', () => {
  it('shows the account its own numbers, as the server counts them', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
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
    await renderApp('/stats', store, sync);
    await screen.findByRole('heading', { level: 1, name: 'Your stats' });
    const section = await screen.findByRole('main');
    expect(within(section).getByRole('group', { name: 'Open tasks' })).toHaveTextContent('0');
    expect(within(section).getByRole('group', { name: 'Closed this month' })).toBeInTheDocument();
    expect(within(section).getByRole('list', { name: 'Closed per month' })).toBeInTheDocument();
  });

  it('without an account says where stats come from', async () => {
    await renderApp('/stats');
    expect(
      await screen.findByText('Stats come from the server: sign in to an account to see them.'),
    ).toBeInTheDocument();
  });
});
