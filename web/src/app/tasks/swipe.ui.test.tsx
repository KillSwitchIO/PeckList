import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('phone');
});

async function inbox(...titles: string[]) {
  const store = testStore();
  await store.getState().init();
  const ids: Record<string, string> = {};
  store.getState().apply((ctx, ws) => {
    let next = ws;
    for (const title of titles) {
      const made = createTask(ctx, next, { title, listId: inboxList(ws).id });
      ids[title] = made.task.id;
      next = made.workspace;
    }
    return next;
  });
  await store.getState().flush();
  await renderApp('/inbox', store);
  const task = (title: string) =>
    store.getState().workspace!.entities.tasks.find((each) => each.id === ids[title])!;
  return { store, task };
}

/** A finger from x0 to x1 (and down by dy) across a row, then off. */
function swipe(row: Element, x0: number, x1: number, dy = 0, pointerId = 1) {
  fireEvent.pointerDown(row, {
    clientX: x0,
    clientY: 20,
    button: 0,
    pointerType: 'touch',
    pointerId,
  });
  const steps = 6;
  for (let i = 1; i <= steps; i += 1) {
    fireEvent.pointerMove(window, {
      clientX: x0 + ((x1 - x0) * i) / steps,
      clientY: 20 + (dy * i) / steps,
      pointerType: 'touch',
      pointerId,
    });
  }
  fireEvent.pointerUp(window, { clientX: x1, clientY: 20 + dy, pointerType: 'touch', pointerId });
}

describe('swiping task rows', () => {
  it('right completes the task, with undo', async () => {
    const { task } = await inbox('Water plants');
    const row = await screen.findByRole('button', { name: 'Open Water plants' });
    swipe(row, 20, 220);
    await waitFor(() => expect(task('Water plants').status).toBe('done'));
    expect(await screen.findByText('Task completed')).toBeInTheDocument();
  });

  it('a short swipe left opens Date, Move and Delete; a long one deletes', async () => {
    const { task } = await inbox('Call mom', 'Old idea');
    const row = await screen.findByRole('button', { name: 'Open Call mom' });
    swipe(row, 300, 220);
    const move = await screen.findByRole('button', { name: 'Move' });
    expect(screen.getByRole('button', { name: 'Date' })).toBeInTheDocument();
    await userEvent.click(move);
    expect(await screen.findByRole('dialog')).toHaveTextContent(/Call mom/);
    await userEvent.keyboard('{Escape}');

    const other = await screen.findByRole('button', { name: 'Open Old idea' });
    swipe(other, 340, 60, 0, 2);
    await waitFor(() => expect(task('Old idea').deletedAt).not.toBeNull());
    expect(await screen.findByText('Task deleted')).toBeInTheDocument();
  });

  it('leaves the row alone when the finger goes up or down, and when it was a tap', async () => {
    const { task } = await inbox('Scroll past me');
    const row = await screen.findByRole('button', { name: 'Open Scroll past me' });
    swipe(row, 100, 160, 120);
    act(() => undefined);
    expect(task('Scroll past me').status).toBe('open');
    expect(within(document.body).queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
