import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createList } from '../../core/lists.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { mockViewport, renderApp, testStore, type Viewport } from '../../test/renderApp.tsx';

// Pull to refresh is on in the Android app and installed apps: synced, and shown standalone.
const syncNow = vi.fn(() => Promise.resolve());
vi.mock('../sync/syncContext.ts', async (original) => {
  const actual = await original<typeof import('../sync/syncContext.ts')>();
  return {
    ...actual,
    useSyncState: <T,>(selector: Parameters<typeof actual.useSyncState<T>>[0]) =>
      actual.useSyncState((state) => selector({ ...state, phase: 'ready', syncNow })),
  };
});

function standalone(viewport: Viewport) {
  mockViewport(viewport);
  const media = window.matchMedia;
  vi.stubGlobal('matchMedia', (query: string) => ({
    ...media(query),
    matches: query.includes('display-mode: standalone') || media(query).matches,
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  syncNow.mockClear();
});

const PULL = { name: 'Pull down to sync' };

/** One finger as a phone sends it, dragged straight down: a pointer event, then the touch event. */
function dragDown(target: Element, x: number, from: number, to: number) {
  const pointer = { pointerType: 'touch', pointerId: 4, isPrimary: true };
  const at = (y: number) => ({ clientX: x, clientY: y, pageX: x, pageY: y });
  fireEvent.pointerDown(target, { ...pointer, button: 0, ...at(from) });
  fireEvent.touchStart(target, { touches: [at(from)] });
  let shown = false;
  let y: number;
  for (y = from + 15; y <= to; y += 15) {
    fireEvent.pointerMove(target, { ...pointer, ...at(y) });
    fireEvent.touchMove(target, { touches: [at(y)] });
    shown ||= screen.queryByRole('status', PULL) !== null;
  }
  fireEvent.pointerUp(target, { ...pointer, ...at(y) });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [at(y)] });
  return shown;
}

async function withLists(path: string) {
  const store = testStore();
  await store.getState().init();
  store.getState().apply((ctx, ws) => {
    let next: WorkspaceFile = ws;
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      next = createList(ctx, next, { name, color: '#CFE3A3' }).workspace;
    }
    return next;
  });
  await store.getState().flush();
  await renderApp(path, store);
}

describe('a row dragged by its grip is never also a pull to refresh', () => {
  it('in Manage lists, while a pull on the rest of a row still refreshes', async () => {
    standalone('phone');
    await withLists('/settings/lists');
    await screen.findByText('Bravo');
    const grip = document.querySelector('[data-drag-handle]')!;
    expect(dragDown(grip, 20, 100, 250)).toBe(false);
    expect(syncNow).not.toHaveBeenCalled();

    // The row's name is not the grip: pulling there is a pull to refresh, as before.
    expect(dragDown(screen.getByText('Bravo'), 120, 100, 300)).toBe(true);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('in the sidebar while it is edited (a big tablet keeps it out)', async () => {
    standalone('desktop');
    await withLists('/today');
    const lists = await screen.findByRole('list', { name: 'Lists' });
    fireEvent.contextMenu(within(lists).getByText('Bravo'));
    await waitFor(() => expect(lists.querySelector('[data-drag-handle]')).not.toBeNull());
    const grip = lists.querySelector('[data-drag-handle]')!;
    expect(dragDown(grip, 20, 300, 450)).toBe(false);
    expect(syncNow).not.toHaveBeenCalled();
  });
});
