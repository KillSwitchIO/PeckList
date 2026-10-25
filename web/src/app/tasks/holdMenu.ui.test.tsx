import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('phone');
});
afterEach(() => vi.useRealTimers());

/** A finger held still on `element` for a second, then lifted. */
function hold(element: Element) {
  fireEvent.pointerDown(element, {
    button: 0,
    pointerType: 'touch',
    pointerId: 9,
    clientX: 20,
    clientY: 20,
  });
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 9, clientX: 20, clientY: 20 });
  fireEvent.pointerUp(element, { pointerType: 'touch', pointerId: 9, clientX: 20, clientY: 20 });
}

describe('holding a task', () => {
  it('on the row only drags (no menu); on the checkbox opens the menu', async () => {
    const store = testStore();
    await store.getState().init();
    store
      .getState()
      .apply(
        (ctx, ws) => createTask(ctx, ws, { title: 'Sweep', listId: inboxList(ws).id }).workspace,
      );
    await store.getState().flush();
    await renderApp('/inbox', store);
    const row = await screen.findByRole('button', { name: 'Open Sweep' });
    vi.useFakeTimers();
    hold(row);
    expect(screen.queryByRole('menu')).toBeNull();
    hold(screen.getByRole('checkbox', { name: 'Complete Sweep' }));
    vi.useRealTimers();
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    // Holding the checkbox did not tick it.
    expect(
      screen.getByRole('checkbox', { name: 'Complete Sweep', hidden: true }),
    ).toBeInTheDocument();
  });
});
