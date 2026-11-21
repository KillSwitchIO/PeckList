import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { todayIn, localTimeZone } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask, toggleTaskDone } from '../../core/tasks.ts';
import type { WidgetFeed as Feed, ShortcutList } from '../../ports/nativeShell.ts';
import { FakeShell } from '../../test/fakeShell.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { AppRoutes } from '../routes.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { setNativeShell } from './shell.ts';
import { WidgetFeed } from './widgetFeed.ts';

/** The shell at api 12, keeping each hand-over to the home-screen widgets. */
class WidgetShell extends FakeShell {
  handed: Feed[] = [];
  constructor(api = 12) {
    super(api);
  }
  setWidgetTasks(feed: Feed) {
    this.handed.push(feed);
    return Promise.resolve();
  }
  shortcuts: ShortcutList[][] = [];
  setShortcuts(lists: ShortcutList[]) {
    this.shortcuts.push(lists);
    return Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  mockViewport('phone');
});
afterEach(() => setNativeShell(null));

async function openToday(shell: WidgetShell) {
  setNativeShell(shell);
  const store = testStore();
  await store.getState().init();
  const today = todayIn(localTimeZone(), Date.now());
  let id = '';
  act(() =>
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, {
        title: 'Water plants',
        listId: inboxList(ws).id,
        schedule: { start: today, end: null, allDay: true, timeZone: localTimeZone() },
      });
      id = made.task.id;
      return made.workspace;
    }),
  );
  // Stored, as the app's own start reads the workspace back from storage.
  await store.getState().flush();
  render(
    <AppProviders store={store}>
      <MemoryRouter initialEntries={['/today']}>
        <AppRoutes />
        <WidgetFeed />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 10_000 });
  return { store, id, today };
}

describe('the home-screen widgets', () => {
  it("get today's tasks, again when one is completed, and nothing unchanged twice", async () => {
    const shell = new WidgetShell();
    const { store, id, today } = await openToday(shell);
    await waitFor(() =>
      expect(shell.handed.at(-1)).toMatchObject({
        asOf: today,
        tasks: [expect.objectContaining({ id, title: 'Water plants', on: today })],
      }),
    );
    const sends = shell.handed.length;
    act(() => store.getState().apply((_ctx, ws) => ws));
    expect(shell.handed).toHaveLength(sends);
    act(() => store.getState().apply((ctx, ws) => toggleTaskDone(ctx, ws, id)));
    await waitFor(() => expect(shell.handed.at(-1)?.tasks).toEqual([]));
  });

  it('are left alone by an older app (api 11 and below)', async () => {
    const shell = new WidgetShell(11);
    await openToday(shell);
    expect(shell.handed).toEqual([]);
  });

  it('are emptied once the person is signed out, as is the list shortcut', async () => {
    localStorage.setItem('pecklist.shortcutList', 'L1');
    const shell = new WidgetShell();
    setNativeShell(shell);
    const store = testStore();
    const transport = new FakeBackend().device();
    transport.session = null;
    const sync = createSyncEngine({
      transport,
      workspace: store,
      storage: createMemoryStorage(),
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    render(
      <AppProviders store={store} sync={sync}>
        <MemoryRouter initialEntries={['/today']}>
          <WidgetFeed />
        </MemoryRouter>
      </AppProviders>,
    );
    await waitFor(() => expect(sync.getState().phase).toBe('signed-out'), { timeout: 10_000 });
    await waitFor(() =>
      expect(shell.handed.at(-1)).toEqual({ asOf: expect.any(String), tasks: [], signedOut: true }),
    );
    expect(shell.shortcuts.at(-1)).toEqual([]);
    expect(localStorage.getItem('pecklist.shortcutList')).toBeNull();
  });
});
