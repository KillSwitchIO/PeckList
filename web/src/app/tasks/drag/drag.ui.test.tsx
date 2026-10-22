import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createList, inboxList } from '../../../core/lists.ts';
import { createTask } from '../../../core/tasks.ts';
import type { WorkspaceFile } from '../../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../../test/renderApp.tsx';

const ROW = 40;
const TOP = 100;

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
  // jsdom has no layout: rows stack 40 px apart from y = 100, in document order.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rows = [...document.querySelectorAll('[data-drag-row]')];
    const box = (top: number, height: number) =>
      ({
        top,
        bottom: top + height,
        left: 240,
        right: 840,
        height,
        width: 600,
        x: 240,
        y: top,
      }) as DOMRect;
    if (this.hasAttribute('data-drag-row')) return box(TOP + rows.indexOf(this) * ROW, ROW);
    if (this.hasAttribute('data-drag-zone')) return box(TOP, rows.length * ROW);
    return box(0, 0);
  });
});
afterEach(() => vi.restoreAllMocks());

/** "Chores" (custom order) with Wash, Dry, Fold; returns titles in order with their depth. */
async function chores() {
  const store = testStore();
  await store.getState().init();
  let listId = '';
  store.getState().apply((ctx, ws) => {
    const made = createList(ctx, ws, { name: 'Chores', color: '#CFE3A3' });
    listId = made.list.id;
    let next = made.workspace;
    for (const title of ['Wash', 'Dry', 'Fold']) {
      next = createTask(ctx, next, { title, listId }).workspace;
    }
    return next;
  });
  await store.getState().flush();
  localStorage.setItem('punchlist.listGrouping', JSON.stringify({ [listId]: 'section' }));
  await renderApp(`/lists/${listId}`, store);
  await screen.findByRole('button', { name: 'Open Fold' });
  const outline = () => {
    const ws: WorkspaceFile = store.getState().workspace!;
    const live = ws.entities.tasks.filter((task) => task.deletedAt === null);
    const depth = (id: string | null): number =>
      id ? 1 + depth(live.find((task) => task.id === id)!.parentId) : 0;
    return [...document.querySelectorAll<HTMLElement>('[data-drag-row]')].map((row) => {
      const task = live.find((each) => each.id === row.dataset.dragRow)!;
      return `${'  '.repeat(depth(task.parentId))}${task.title}`;
    });
  };
  return { store, outline };
}

/** Press on a row's title and move the pointer (window listeners, like a real drag). */
function drag(title: string, to: { x: number; y: number }) {
  const row = screen.getByRole('button', { name: `Open ${title}` });
  const rows = [...document.querySelectorAll('[data-drag-row]')];
  const start = TOP + rows.indexOf(row.closest('[data-drag-row]')!) * ROW + ROW / 2;
  fireEvent.pointerDown(row, { button: 0, clientX: 300, clientY: start, pointerType: 'mouse' });
  fireEvent.pointerMove(window, { clientX: 300, clientY: start + 10 });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y });
  return () => fireEvent.pointerUp(window);
}

describe('dragging tasks in a list', () => {
  it('reorders, showing where it lands', async () => {
    const { outline } = await chores();
    // Fold up above Wash.
    const release = drag('Fold', { x: 300, y: TOP + 5 });
    expect(screen.getByTestId('drop-line')).toBeInTheDocument();
    release();
    await waitFor(() => expect(outline()).toEqual(['Fold', 'Wash', 'Dry']));
    expect(screen.queryByTestId('drop-line')).toBeNull();
  });

  it('nests when pulled right, under the task above', async () => {
    const { outline } = await chores();
    // Dry stays in place but moves one indent to the right: Wash's subtask.
    drag('Dry', { x: 300 + 30, y: TOP + ROW + 20 })();
    await waitFor(() => expect(outline()).toEqual(['Wash', '  Dry', 'Fold']));
    // And back out.
    drag('Dry', { x: 300 - 30, y: TOP + ROW + 20 })();
    await waitFor(() => expect(outline()).toEqual(['Wash', 'Dry', 'Fold']));
  });

  it('Escape calls a drag off', async () => {
    const { outline } = await chores();
    drag('Fold', { x: 300, y: TOP + 5 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('drop-line')).toBeNull();
    fireEvent.pointerUp(window);
    expect(outline()).toEqual(['Wash', 'Dry', 'Fold']);
  });

  it('a click without moving still opens the task', async () => {
    await chores();
    await userEvent.click(screen.getByRole('button', { name: 'Open Dry' }));
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeInTheDocument();
  });

  it('drops onto a list in the sidebar', async () => {
    const { store } = await chores();
    const inbox = () => inboxList(store.getState().workspace!).id;
    const drawer = within(screen.getAllByRole('navigation')[0]!)
      .getByText('Mess Drawer')
      .closest<HTMLElement>('[data-drop-list]')!;
    document.elementFromPoint = (x: number) => (x < 200 ? drawer : null);
    drag('Wash', { x: 100, y: 300 })();
    await waitFor(() =>
      expect(
        store.getState().workspace!.entities.tasks.find((task) => task.title === 'Wash')!.listId,
      ).toBe(inbox()),
    );
  });

  it('Alt+arrows move from the keyboard', async () => {
    const { outline } = await chores();
    screen.getByRole('button', { name: 'Open Fold' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(outline()).toEqual(['Wash', 'Fold', 'Dry']);
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(outline()).toEqual(['Wash', '  Fold', 'Dry']);
  });
});
