import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

async function settingsAs(backend: FakeBackend, username: string) {
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
  await renderApp('/settings/data', store, sync);
}

describe('settings: usage stats (PL-116)', () => {
  it("turns the person's sharing off for all their devices", async () => {
    const backend = new FakeBackend();
    backend.telemetryOn = true;
    backend.addAccount('sam', 'a long enough password');
    await settingsAs(backend, 'sam');
    const section = await screen.findByRole('region', { name: 'Usage stats' });
    const share = within(section).getByRole('switch', { name: 'Share anonymous usage stats' });
    expect(share).toBeChecked();
    await userEvent.click(share);
    await waitFor(() => expect(backend.shareUsage.get('sam')).toBe(false));
    expect(share).not.toBeChecked();
  });

  it('is not there when the server sends no report', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    await settingsAs(backend, 'sam');
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('region', { name: 'Usage stats' })).toBeNull();
  });
});
