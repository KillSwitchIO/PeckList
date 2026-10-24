import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from './syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function signedIn() {
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
  await renderApp('/today', store, sync);
  await waitFor(() => expect(sync.getState().phase).toBe('ready'));
  return { backend, store, sync };
}

describe('what the server takes back', () => {
  it('says when a change was refused and undone here', async () => {
    const { backend, store, sync } = await signedIn();
    let id = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, { title: 'Not allowed', listId: inboxList(ws)!.id });
        id = made.task.id;
        return made.workspace;
      }),
    );
    backend.server.refuse.add(id);
    await act(() => sync.getState().syncNow());

    expect(
      await screen.findByText('The server did not accept one of your changes, so it was undone.'),
    ).toBeInTheDocument();
    expect(store.getState().workspace!.entities.tasks.some((task) => task.id === id)).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(sync.getState().notice).toBeNull());
  });

  it('says when a shared list was taken away', async () => {
    const { backend, store, sync } = await signedIn();
    let id = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createList(ctx, ws, { name: 'Chores', color: '#A7C7E7' });
        id = made.list.id;
        return made.workspace;
      }),
    );
    await act(() => sync.getState().syncNow());
    backend.server.revokeNext = [id];
    await act(() => sync.getState().syncNow());

    expect(await screen.findByText('You no longer have access to "Chores".')).toBeInTheDocument();
    expect(store.getState().workspace!.entities.lists.some((list) => list.id === id)).toBe(false);
  });
});
