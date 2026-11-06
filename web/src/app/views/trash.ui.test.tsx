import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createList, inboxList } from '../../core/lists.ts';
import { createTask, deleteTask } from '../../core/tasks.ts';
import { isPurged } from '../../core/trash.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** The trash with "Old receipt" and "Spare key" in it. */
async function trashWithTwo() {
  const store = testStore();
  await renderApp('/trash', store);
  store.getState().apply((ctx, ws) => {
    let next = ws;
    for (const title of ['Old receipt', 'Spare key']) {
      const made = createTask(ctx, next, { title, listId: inboxList(next).id });
      next = deleteTask(ctx, made.workspace, made.task.id);
    }
    return next;
  });
  const tasks = () => store.getState().workspace!.entities.tasks;
  return { tasks, store };
}

describe('trash', () => {
  it('deletes one task forever after asking', async () => {
    const { tasks } = await trashWithTwo();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete Old receipt forever' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    await waitFor(() => expect(screen.queryByText('Old receipt')).toBeNull());
    expect(screen.getByText('Spare key')).toBeInTheDocument();
    expect(
      tasks()
        .filter(isPurged)
        .map((task) => task.title),
    ).toEqual(['']);
  });

  it('groups what is in it by the day it was deleted, with a count', async () => {
    await trashWithTwo();
    const today = await screen.findByRole('button', { name: /, Today/ });
    expect(today).toHaveTextContent('2');
    expect(screen.getByText('Old receipt')).toBeInTheDocument();
    expect(screen.getByText('Spare key')).toBeInTheDocument();
  });

  it("keeps trash in a list someone else owns apart: Empty trash leaves it, and it can't be erased", async () => {
    const { tasks, store } = await trashWithTwo();
    store.getState().apply((ctx, ws) => {
      const list = createList(ctx, ws, { name: 'Their list', color: '#A7C7E7' });
      const made = createTask(ctx, list.workspace, { title: 'Their task', listId: list.list.id });
      const gone = deleteTask(ctx, made.workspace, made.task.id);
      return {
        ...gone,
        entities: {
          ...gone.entities,
          lists: gone.entities.lists.map((each) =>
            each.id === list.list.id
              ? { ...each, createdBy: '01ARZ3NDEKTSV4RRFFQ69G5FAV', visibility: 'shared' as const }
              : each,
          ),
        },
      };
    });

    await screen.findByRole('button', { name: /In lists others own/ });
    expect(await screen.findByText('Their task')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Their task forever' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Empty trash' }));
    await waitFor(() => expect(screen.queryByText('Old receipt')).toBeNull());
    expect(screen.getByText('Their task')).toBeInTheDocument();
    expect(tasks().find((task) => task.title === 'Their task')!.deletedAt).not.toBeNull();
    // Nothing left of mine to empty: the button goes.
    expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
  });

  it('empties the trash', async () => {
    const { tasks } = await trashWithTwo();
    await userEvent.click(await screen.findByRole('button', { name: 'Empty trash' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Empty trash' }));
    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument();
    expect(tasks().every(isPurged)).toBe(true);
    // Nothing left to empty: the button goes.
    expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
  });

  it('shows a big trash a page at a time', async () => {
    const store = testStore();
    await renderApp('/trash', store);
    store.getState().apply((ctx, ws) => {
      let next = ws;
      for (let i = 0; i < 230; i += 1) {
        const made = createTask(ctx, next, { title: `Imported ${i}`, listId: inboxList(next).id });
        next = deleteTask(ctx, made.workspace, made.task.id);
      }
      return next;
    });
    const rows = () =>
      screen.getAllByRole('button', { name: /^Delete Imported \d+ forever$/ }).length;
    await waitFor(() => expect(rows()).toBe(100));
    await userEvent.click(screen.getByRole('button', { name: 'Show 100 more' }));
    expect(rows()).toBe(200);
    await userEvent.click(screen.getByRole('button', { name: 'Show 30 more' }));
    expect(rows()).toBe(230);
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });
});
