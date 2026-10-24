import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { logReminder } from '../reminders/reminderLog.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function signedIn(path: string, backend: FakeBackend) {
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
  const result = await renderApp(path, store, sync);
  await waitFor(() => expect(sync.getState().phase).toBe('ready'));
  return { ...result, sync };
}

describe('notifications', () => {
  it('show the server and this device together, with a dot on the picture until read', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const sam = backend.addAccount('sam', 'sams own password');
    const { store, sync } = await signedIn('/today', backend);
    let taskId = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, { title: 'Mow the lawn', listId: inboxList(ws).id });
        taskId = made.task.id;
        return made.workspace;
      }),
    );
    backend.notifications.set('ben', [
      {
        id: 'N1',
        kind: 'assigned',
        at: '2026-10-24T15:00:00.000Z',
        actorId: sam.id,
        taskId,
        listId: null,
        commentId: null,
        read: false,
      },
    ]);
    act(() => logReminder({ id: `${taskId}@1`, taskId, at: Date.parse('2026-10-24T14:00:00Z') }));
    await act(() => sync.getState().syncNow());

    const avatar = await screen.findByRole('button', { name: /2 new notifications/ });
    await userEvent.click(avatar);
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Notifications/ }));
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const entries = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(entries[0]).toMatch(/assigned you Mow the lawn/);
    expect(entries[1]).toMatch(/Reminder: Mow the lawn/);
    // Seen: read on the server and here, and the dot goes.
    await waitFor(() => expect(backend.notifications.get('ben')![0]!.read).toBe(true), {
      timeout: 4000,
    });
    expect(screen.queryByRole('button', { name: /new notifications/ })).toBeNull();

    await userEvent.click(within(list).getByRole('button', { name: /^Clear: Reminder/ }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(await screen.findByText('Nothing new')).toBeInTheDocument();
    expect(backend.notifications.get('ben')).toEqual([]);
  });

  it('open the task they are about', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await signedIn('/notifications', backend);
    let taskId = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, { title: 'Call the vet', listId: inboxList(ws).id });
        taskId = made.task.id;
        return made.workspace;
      }),
    );
    act(() => logReminder({ id: `${taskId}@2`, taskId, at: Date.now() }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'New: Reminder: Call the vet' }),
    );
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeInTheDocument();
  });
});
