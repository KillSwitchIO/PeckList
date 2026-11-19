import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createList, updateList } from '../../core/lists.ts';
import type { ShortcutList } from '../../ports/nativeShell.ts';
import { FakeShell } from '../../test/fakeShell.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { AppRoutes } from '../routes.tsx';
import { ListShortcuts, shortcutLists } from './listShortcuts.ts';
import { setNativeShell } from './shell.ts';

/** The shell at api 11, keeping each list hand-over for the launcher's long-press menu. */
class ShortcutShell extends FakeShell {
  handed: ShortcutList[][] = [];
  constructor(api = 11) {
    super(api);
  }
  setShortcuts(lists: ShortcutList[]) {
    this.handed.push(lists);
    return Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  mockViewport('phone');
});
afterEach(() => setNativeShell(null));

describe('the Add task shortcut', () => {
  it('opens Today with the add-task field focused', async () => {
    await renderApp('/today?add=1');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-add-task'));
  });
});

describe("the launcher's list shortcut", () => {
  async function openList(shell: ShortcutShell) {
    setNativeShell(shell);
    const store = testStore();
    await store.getState().init();
    let id = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createList(ctx, ws, { name: 'Groceries', color: '#5A8A4E' });
        id = made.list.id;
        return made.workspace;
      }),
    );
    // Stored, as the app's own start reads the workspace back from storage.
    await store.getState().flush();
    render(
      <AppProviders store={store}>
        <MemoryRouter initialEntries={[`/lists/${id}`]}>
          <AppRoutes />
          <ListShortcuts />
        </MemoryRouter>
      </AppProviders>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Groceries' }, { timeout: 10_000 });
    return { store, id };
  }

  it('follows the list opened last, renamed with it, and goes when it is archived', async () => {
    const shell = new ShortcutShell();
    const { store, id } = await openList(shell);
    await waitFor(() => expect(shell.handed.at(-1)).toEqual([{ id, name: 'Groceries' }]));
    act(() => store.getState().apply((ctx, ws) => updateList(ctx, ws, id, { name: 'Shopping' })));
    await waitFor(() => expect(shell.handed.at(-1)).toEqual([{ id, name: 'Shopping' }]));
    const sends = shell.handed.length;
    act(() => store.getState().apply((ctx, ws) => updateList(ctx, ws, id, { color: '#000000' })));
    // Nothing the shortcut shows changed: no hand-over.
    expect(shell.handed).toHaveLength(sends);
    act(() => store.getState().apply((ctx, ws) => updateList(ctx, ws, id, { archived: true })));
    await waitFor(() => expect(shell.handed.at(-1)).toEqual([]));
  });

  it('ignores an address that is not a list id, such as a stray escape', async () => {
    const shell = new ShortcutShell();
    setNativeShell(shell);
    const store = testStore();
    await store.getState().init();
    render(
      <AppProviders store={store}>
        <MemoryRouter initialEntries={['/lists/%E0']}>
          <AppRoutes />
          <ListShortcuts />
        </MemoryRouter>
      </AppProviders>,
    );
    await waitFor(() => expect(shell.handed.at(-1)).toEqual([]));
    expect(localStorage.getItem('pecklist.shortcutList')).toBeNull();
  });

  it('is left alone by an older app (api 10 and below)', async () => {
    const shell = new ShortcutShell(10);
    await openList(shell);
    expect(shell.handed).toEqual([]);
  });
});

describe('shortcutLists', () => {
  it('offers the list opened last while it is still there', () => {
    const lists = [
      { id: 'A', name: 'Work' },
      { id: 'B', name: 'Home' },
    ] as never;
    expect(shortcutLists(lists, 'B')).toEqual([{ id: 'B', name: 'Home' }]);
    expect(shortcutLists(lists, 'gone')).toEqual([]);
    expect(shortcutLists(lists, null)).toEqual([]);
  });
});
