import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

// One touch, one gesture in the task sheet on a phone: a reorder handle's touch is the reorder's,
// never also a swipe of the sheet or a pull of the comments (the gesture conflict sweep, rc.4).

const PANEL = { name: 'Comments and history' };
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
// Page and client alike, as a real touch has both: the sheet's swipe (MUI) reads the page ones.
const finger = (y: number) => ({ clientX: 100, clientY: y, pageX: 100, pageY: y });
let lastY = 0;
const touch = (y: number) => {
  lastY = y;
  return { touches: [finger(y)] };
};
const lift = () => ({ changedTouches: [finger(lastY)] });

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('phone');
});
afterEach(() => vi.useRealTimers());

/** "Plan trip" (two subtasks, and `notes`) open in the task sheet. */
async function tripOpen(notes = '') {
  const store = testStore();
  await renderApp('/inbox', store);
  act(() =>
    store.getState().apply((ctx, ws) => {
      const listId = inboxList(ws).id;
      const trip = createTask(ctx, ws, { title: 'Plan trip', listId, notes });
      const flights = createTask(ctx, trip.workspace, {
        title: 'Book flights',
        listId,
        parentId: trip.task.id,
      });
      return createTask(ctx, flights.workspace, { title: 'Pack', listId, parentId: trip.task.id })
        .workspace;
    }),
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Open Plan trip' }));
  const details = await screen.findByRole('region', { name: 'Task details' });
  // The task's own bottom sheet, given a height so its swipe has room to move.
  const sheet = details.closest<HTMLElement>('.MuiDrawer-paper')!;
  Object.defineProperty(sheet, 'clientHeight', { value: 700, configurable: true });
  return { details, sheet };
}

/** How far the sheet's own swipe has moved it down, in px (0 when it has not). */
function sheetDown(paper: HTMLElement) {
  const match = /translate\(0(?:px)?, (-?[\d.]+)px\)/.exec(paper.style.transform);
  return match ? Number(match[1]) : 0;
}

/** A finger on `handle` going from `from` through `path`, then lifting. */
function drag(handle: HTMLElement, from: number, path: number[]) {
  fireEvent.touchStart(handle, touch(from));
  for (const y of path) fireEvent.touchMove(handle, touch(y));
}

const stillOpen = () => screen.queryByRole('region', { name: 'Task details' }) !== null;

describe('a reorder handle in the task sheet keeps its touch to itself', () => {
  it('a subtask dragged down does not drag the task sheet, nor close the task', async () => {
    const { details, sheet } = await tripOpen();
    const handle = within(details).getByRole('button', { name: 'Move Book flights' });
    drag(handle, 400, [420, 500, 640]);
    expect(sheetDown(sheet)).toBe(0);
    fireEvent.touchEnd(handle, lift());
    await wait(300);
    expect(sheetDown(sheet)).toBe(0);
    expect(stillOpen()).toBe(true);
  });

  it('a subtask dragged up does not pull up the comments', async () => {
    const { details } = await tripOpen();
    const handle = within(details).getByRole('button', { name: 'Move Pack' });
    drag(handle, 500, [490, 440, 380]);
    await wait(50);
    expect(screen.queryByRole('dialog', PANEL)).toBeNull();
    fireEvent.touchEnd(handle, lift());
  });

  it('a list item in the notes, dragged down or up, moves neither the sheet nor the comments', async () => {
    const { details, sheet } = await tripOpen('- one\n- two\n- three');
    const [handle] = await within(details).findAllByRole('button', { name: 'Move this item' });
    drag(handle!, 400, [420, 520, 640]);
    expect(sheetDown(sheet)).toBe(0);
    fireEvent.touchEnd(handle!, lift());
    await wait(300);
    expect(stillOpen()).toBe(true);
    drag(handle!, 500, [490, 440, 380]);
    await wait(50);
    expect(screen.queryByRole('dialog', PANEL)).toBeNull();
    fireEvent.touchEnd(handle!, lift());
  });

  it('a heading in the notes, dragged down or up, moves neither the sheet nor the comments', async () => {
    const { details, sheet } = await tripOpen('# Before\n\nPack bags\n\n# After\n\nUnpack');
    const [handle] = await within(details).findAllByRole('button', {
      name: 'Move this heading and everything under it',
    });
    drag(handle!, 400, [420, 520, 640]);
    expect(sheetDown(sheet)).toBe(0);
    fireEvent.touchEnd(handle!, lift());
    await wait(300);
    expect(stillOpen()).toBe(true);
    drag(handle!, 500, [490, 440, 380]);
    await wait(50);
    expect(screen.queryByRole('dialog', PANEL)).toBeNull();
    fireEvent.touchEnd(handle!, lift());
  });

  it('after a long press on a subtask (its menu), the finger moving on does not drag the sheet', async () => {
    const { details, sheet } = await tripOpen();
    const row = details.querySelector<HTMLElement>('[data-subtask-row]')!;
    vi.useFakeTimers();
    fireEvent.touchStart(row, touch(400));
    fireEvent.pointerDown(row, {
      button: 0,
      pointerType: 'touch',
      pointerId: 7,
      clientX: 100,
      clientY: 400,
    });
    act(() => vi.advanceTimersByTime(600));
    for (const y of [420, 520, 640]) fireEvent.touchMove(row, touch(y));
    expect(sheetDown(sheet)).toBe(0);
    fireEvent.pointerUp(row, { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 640 });
    fireEvent.touchEnd(row, lift());
    vi.useRealTimers();
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    // The touch after it is nobody's but its own: a swipe down moves the sheet again.
    await userEvent.keyboard('{Escape}');
    const title = within(details).getAllByRole('textbox', { name: 'Title' })[0]!;
    drag(title, 300, [320, 380]);
    await waitFor(() => expect(sheetDown(sheet)).toBeGreaterThan(0));
    fireEvent.touchEnd(title, lift());
  });

  it('a swipe down on the details beside the handles still moves the sheet, as before', async () => {
    const { details, sheet } = await tripOpen();
    const title = within(details).getAllByRole('textbox', { name: 'Title' })[0]!;
    drag(title, 300, [320, 380]);
    await waitFor(() => expect(sheetDown(sheet)).toBeGreaterThan(0));
    fireEvent.touchEnd(title, lift());
  });
});
