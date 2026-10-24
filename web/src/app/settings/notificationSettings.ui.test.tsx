import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createBrowserPush } from '../../adapters/browser-push.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import type { BrowserPush, PushSubscriptionData } from '../../ports/notifier.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { logReminder } from '../reminders/reminderLog.ts';
import { setBrowserPush } from '../reminders/notifier.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});
afterEach(() => setBrowserPush(createBrowserPush()));

function fakePush(supported = true) {
  let current: PushSubscriptionData | null = null;
  const push: BrowserPush & { keys: string[] } = {
    keys: [],
    supported: () => supported,
    current: () => Promise.resolve(current),
    subscribe: (key) => {
      push.keys.push(key);
      current = { endpoint: 'https://push.example/ben', keys: { p256dh: 'p', auth: 'a' } };
      return Promise.resolve(current);
    },
    unsubscribe: () => {
      const had = current?.endpoint ?? null;
      current = null;
      return Promise.resolve(had);
    },
  };
  return push;
}

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
  return { ...result, sync, transport };
}

describe('notifications with the app closed', () => {
  it('are turned on and off for this device in Settings', async () => {
    const push = fakePush();
    setBrowserPush(push);
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { transport } = await signedIn('/settings', backend);
    const section = await screen.findByRole('region', { name: 'Notifications' });
    const toggle = within(section).getByRole('switch', {
      name: 'Notify me when Punchlist is closed',
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(push.keys).toEqual(['BFAKEKEY']);
    expect(transport.pushed.get('https://push.example/ben')).toBe('ben');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(transport.pushed.size).toBe(0);
  });

  it('say where they cannot work', async () => {
    setBrowserPush(fakePush(false));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await signedIn('/settings', backend);
    expect(await screen.findByText(/add Punchlist to your Home Screen/)).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Notify me when Punchlist is closed' }),
    ).toBeDisabled();
  });

  it('show a reminder the server also sent only once', async () => {
    setBrowserPush(fakePush());
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store, sync } = await signedIn('/notifications', backend);
    let taskId = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, { title: 'Water plants', listId: inboxList(ws).id });
        taskId = made.task.id;
        return made.workspace;
      }),
    );
    const at = Date.parse('2026-10-24T14:00:00Z');
    act(() => logReminder({ id: `${taskId}@${at}`, taskId, at }));
    backend.notifications.set('ben', [
      {
        id: 'S1',
        kind: 'reminder',
        at: new Date(at).toISOString(),
        actorId: null,
        taskId,
        listId: null,
        commentId: null,
        read: false,
      },
    ]);
    await act(() => sync.getState().syncNow());
    const list = await screen.findByRole('list', { name: 'Notifications' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
  });
});
