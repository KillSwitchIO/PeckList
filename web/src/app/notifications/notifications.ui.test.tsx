import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { inboxList } from '../../core/lists.ts';
import { addComment } from '../../core/comments.ts';
import { createTask } from '../../core/tasks.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { logReminder } from '../reminders/reminderLog.ts';
import { notifier, setNotifier } from '../reminders/notifier.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';

const browser = notifier();

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
  setNotifier(browser);
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

  it('news arriving while the app is open shows as a system notification, once', async () => {
    const shown: unknown[] = [];
    setNotifier({
      ...browser,
      permission: () => 'granted',
      show: (notification) => {
        shown.push(notification);
        return Promise.resolve();
      },
    });
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
    const news = (id: string, kind: 'assigned' | 'groupAssigned') => ({
      id,
      kind,
      at: '2026-10-24T15:00:00.000Z',
      actorId: sam.id,
      taskId,
      listId: null,
      commentId: null,
      read: false,
    });
    // Signing in was the first look (nothing there); what the next sync brings is news.
    expect(shown).toEqual([]);
    backend.notifications.set('ben', [news('N1', 'assigned')]);
    await act(() => sync.getState().syncNow());
    await screen.findByRole('button', { name: /1 new notification/ });
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0]).toMatchObject({
      kind: 'news',
      tag: 'N1',
      body: expect.stringMatching(/assigned you Mow the lawn$/) as string,
    });

    backend.notifications.set('ben', [news('N2', 'groupAssigned'), news('N1', 'assigned')]);
    await act(() => sync.getState().syncNow());
    await screen.findByRole('button', { name: /2 new notifications/ });
    await waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1]).toEqual({
      kind: 'news',
      title: 'Punchlist',
      body: expect.stringMatching(/assigned Mow the lawn to your group$/) as string,
      tag: 'N2',
      url: `/today?task=${taskId}`,
      actions: [
        { action: 'open', title: 'Open task', url: `/today?task=${taskId}` },
        { action: 'dibs', title: 'Call dibs', url: `/today?task=${taskId}&dibs=1` },
      ],
    });

    // Seen once: the next sync does not show them again.
    await act(() => sync.getState().syncNow());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown).toHaveLength(2);
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

  it('a comment offers Reply (left) and a thumbs up (right) (R-FB-106)', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const sam = backend.addAccount('sam', 'sams own password');
    const { store, sync } = await signedIn('/today', backend);
    let taskId = '';
    let commentId = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, { title: 'Paint the shed', listId: inboxList(ws).id });
        taskId = made.task.id;
        const said = addComment(ctx, made.workspace, taskId, 'Blue or green?');
        commentId = said.comment.id;
        return said.workspace;
      }),
    );
    backend.notifications.set('ben', [
      {
        id: 'N2',
        kind: 'commented',
        at: '2026-10-24T15:00:00.000Z',
        actorId: sam.id,
        taskId,
        listId: null,
        commentId,
        read: false,
      },
    ]);
    await act(() => sync.getState().syncNow());
    await userEvent.click(await screen.findByRole('button', { name: /new notification/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Notifications/ }));
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const item = within(list).getByRole('listitem');
    expect(item).toHaveTextContent(/commented on Paint the shed/);
    const [reply, like] = within(item)
      .getAllByRole('button')
      .filter((button) =>
        /^(Reply|Thumbs up)$/.test(button.getAttribute('aria-label') ?? button.textContent ?? ''),
      );
    expect(reply).toHaveTextContent('Reply');
    expect(like).toHaveAccessibleName('Thumbs up');

    await userEvent.click(like!);
    const comments = () =>
      store.getState().workspace!.entities.comments.filter((each) => each.taskId === taskId);
    expect(comments().map((each) => each.body)).toEqual(['Blue or green?', '👍']);

    await userEvent.click(reply!);
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('comment') ?? commentId).toBe(commentId);
  });

  it('a task shows its history under the comments (R-FB-105)', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const sam = backend.addAccount('sam', 'sams own password');
    const { store, sync } = await signedIn('/inbox', backend);
    let taskId = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, { title: 'Mow the lawn', listId: inboxList(ws).id });
        taskId = made.task.id;
        return made.workspace;
      }),
    );
    backend.history.set(taskId, [
      {
        id: 'H2',
        at: '2026-10-27T15:00:00.000Z',
        actorId: sam.id,
        field: 'priority',
        before: '0',
        after: '3',
      },
      {
        id: 'H1',
        at: '2026-10-27T14:00:00.000Z',
        actorId: null,
        field: 'created',
        before: null,
        after: '"Mow"',
      },
    ]);
    await act(() => sync.getState().syncNow());
    await userEvent.click(await screen.findByRole('button', { name: 'Open Mow the lawn' }));
    const history = await screen.findByRole('region', { name: 'History' });
    const lines = within(history)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(lines[0]).toMatch(/set the priority to High/);
    expect(lines[1]).toMatch(/^Someone created this task/);
  });

  it('a phone swipes up from the bottom bar to the comments and history (R-FB-109)', async () => {
    mockViewport('phone');
    const store = testStore();
    await renderApp('/inbox', store);
    act(() =>
      store
        .getState()
        .apply(
          (ctx, ws) =>
            createTask(ctx, ws, { title: 'Water plants', listId: inboxList(ws).id }).workspace,
        ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open Water plants' }));
    const bar = await screen.findByRole('button', { name: 'Comments and history' });
    fireEvent.touchStart(bar, { touches: [{ clientX: 100, clientY: 700 }] });
    fireEvent.touchMove(bar, { touches: [{ clientX: 100, clientY: 600 }] });
    const panel = await screen.findByRole('dialog', { name: 'Comments and history' });
    expect(within(panel).getByRole('region', { name: 'History' })).toBeInTheDocument();
  });
});
