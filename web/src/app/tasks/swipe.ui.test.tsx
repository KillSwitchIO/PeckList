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
  it('a short swipe right shows Complete and Pin', async () => {
    await inbox('Water plants');
    swipe(await screen.findByRole('button', { name: 'Open Water plants' }), 20, 120);
    const complete = await screen.findByRole('button', { name: 'Complete' });
    const pin = screen.getByRole('button', { name: 'Pin' });
    expect(complete.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a full swipe right completes the task, with undo', async () => {
    const { task } = await inbox('Water plants');
    const row = await screen.findByRole('button', { name: 'Open Water plants' });
    swipe(row, 20, 340);
    await waitFor(() => expect(task('Water plants').status).toBe('done'));
    expect(await screen.findByText('Task completed')).toBeInTheDocument();
  });

  it('a full swipe left picks the date', async () => {
    await inbox('Water plants');
    swipe(await screen.findByRole('button', { name: 'Open Water plants' }), 340, 60);
    expect(await screen.findByRole('button', { name: 'Today' })).toBeInTheDocument();
  });

  it('follows the swipe settings: buttons, their order, and the full swipe', async () => {
    localStorage.setItem(
      'punchlist.swipes',
      JSON.stringify({
        right: { buttons: [], full: 'complete' },
        left: { buttons: ['pin', 'wontDo'], full: null },
      }),
    );
    const { task } = await inbox('Sweep', 'Dust');
    swipe(await screen.findByRole('button', { name: 'Open Sweep' }), 20, 220);
    await waitFor(() => expect(task('Sweep').status).toBe('done'));

    // No full swipe left: even a long one only opens the buttons.
    swipe(await screen.findByRole('button', { name: 'Open Dust' }), 340, 40, 0, 2);
    const pin = await screen.findByRole('button', { name: 'Pin' });
    const wontDo = screen.getByRole('button', { name: "Won't do" });
    expect(pin.compareDocumentPosition(wontDo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(task('Dust').deletedAt).toBeNull();
    await userEvent.click(wontDo);
    await waitFor(() => expect(task('Dust').status).toBe('wontdo'));
  });

  it('a short swipe left opens Date, Move and Delete, and Delete deletes', async () => {
    const { task } = await inbox('Call mom', 'Old idea');
    const row = await screen.findByRole('button', { name: 'Open Call mom' });
    swipe(row, 300, 220);
    const move = await screen.findByRole('button', { name: 'Move' });
    expect(screen.getByRole('button', { name: 'Date' })).toBeInTheDocument();
    await userEvent.click(move);
    expect(await screen.findByRole('dialog')).toHaveTextContent(/Call mom/);
    await userEvent.keyboard('{Escape}');

    const other = await screen.findByRole('button', { name: 'Open Old idea' });
    swipe(other, 300, 220, 0, 2);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
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

  it('does not swipe while its menu is open: the progress slider drags instead', async () => {
    const { task } = await inbox('Water plants');
    const row = await screen.findByRole('button', { name: 'Open Water plants' });
    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    const slider = await screen.findByRole('slider', { name: 'Progress' });
    // A finger across the slider (in the menu), and one across the row while the menu is open.
    swipe(slider, 20, 260);
    swipe(row, 20, 260);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(task('Water plants').status).toBe('open');
    expect(screen.queryByText('Task completed')).toBeNull();
    // Closed, it swipes again.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    swipe(row, 20, 340);
    await waitFor(() => expect(task('Water plants').status).toBe('done'));
  });
});
