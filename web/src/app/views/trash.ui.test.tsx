import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { createTask, deleteTask, updateTask } from '../../core/tasks.ts';
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
  // PL-149: laid out as the other views' rows, with its list and day where their details go.
  it('shows each deleted task as a row with its list and the day it went, then its actions', async () => {
    await trashWithTwo();
    const title = await screen.findByText('Old receipt');
    const row = title.closest('li')!;
    expect(row.closest('ul')).not.toBeNull();
    expect(within(row).getByText('Mess Drawer')).toBeInTheDocument();
    expect(within(row).getByText(/^Deleted /)).toBeInTheDocument();
    expect(
      within(row)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Open Old receipt', 'Restore', 'Delete Old receipt forever']);
  });

  // Ben, rc.3: a click on a Trash row opens the task, as a row does in the other views.
  it('opens a deleted task from its row, to read with what went with it, and nothing to edit', async () => {
    const store = testStore();
    await renderApp('/trash', store);
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, { title: 'Old receipt', listId: inboxList(ws).id });
      const noted = updateTask(ctx, made.workspace, made.task.id, { notes: 'Keep for taxes' });
      const sub = createTask(ctx, noted, { title: 'Scan it', listId: '', parentId: made.task.id });
      return deleteTask(ctx, sub.workspace, made.task.id);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open Old receipt' }));

    const details = await screen.findByRole('region', { name: 'Task details' });
    expect(
      within(details).getByText('This task is in the Trash. Restore it to change it.'),
    ).toBeInTheDocument();
    expect(within(details).getByRole('heading', { name: 'Old receipt' })).toBeInTheDocument();
    expect(within(details).getByText('Mess Drawer')).toBeInTheDocument();
    expect(within(details).getByText(/^Deleted /)).toBeInTheDocument();
    expect(await within(details).findByText('Keep for taxes')).toBeInTheDocument();
    expect(within(details).getByText('Scan it')).toBeInTheDocument();
    // Nothing to change while it is deleted: no title field, checkbox or task menu.
    expect(within(details).queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(within(details).queryByRole('checkbox')).toBeNull();
    expect(within(details).queryByRole('button', { name: 'Task actions' })).toBeNull();
    // The subtask went with it and has no row of its own.
    expect(screen.queryByRole('button', { name: 'Open Scan it' })).toBeNull();
  });

  it('restores from the details, which then become the usual ones', async () => {
    const { tasks } = await trashWithTwo();
    await userEvent.click(await screen.findByRole('button', { name: 'Open Old receipt' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Restore' }));

    await waitFor(() =>
      expect(tasks().find((task) => task.title === 'Old receipt')!.deletedAt).toBeNull(),
    );
    const live = await screen.findByRole('region', { name: 'Task details' });
    expect(within(live).getByRole('textbox', { name: 'Title' })).toHaveValue('Old receipt');
    expect(within(live).queryByText(/is in the Trash/)).toBeNull();
    // Gone from the Trash's rows.
    expect(screen.queryByRole('button', { name: 'Open Old receipt' })).toBeNull();
  });

  it('deletes forever from the details after asking, then closes them', async () => {
    const { tasks } = await trashWithTwo();
    await userEvent.click(await screen.findByRole('button', { name: 'Open Old receipt' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Delete forever' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull());
    expect(screen.queryByText(/no longer exists/)).toBeNull();
    expect(screen.queryByText('Old receipt')).toBeNull();
    expect(screen.getByText('Spare key')).toBeInTheDocument();
    expect(tasks().filter(isPurged)).toHaveLength(1);
  });

  it('closes the open details when Empty trash takes the task', async () => {
    await trashWithTwo();
    await userEvent.click(await screen.findByRole('button', { name: 'Open Spare key' }));
    await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Empty trash' }));

    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull());
  });

  it('offers no Delete forever in the details of a task in a list someone else owns', async () => {
    const store = testStore();
    await renderApp('/trash', store);
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
    await userEvent.click(await screen.findByRole('button', { name: 'Open Their task' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    expect(within(details).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(within(details).queryByRole('button', { name: 'Delete forever' })).toBeNull();
  });

  it('cleans up only after hearing from the server, never from a stale copy', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const transport = backend.device();
    transport.session = 'ben';
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = transport.sync.bind(transport);
    transport.sync = async (request: Parameters<typeof sync>[0]) => {
      await held;
      return sync(request);
    };
    const store = testStore();
    await store.getState().init();
    let id = '';
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, { title: 'Old trash', listId: inboxList(ws).id });
      id = made.task.id;
      const gone = deleteTask(ctx, made.workspace, made.task.id);
      return {
        ...gone,
        entities: {
          ...gone.entities,
          tasks: gone.entities.tasks.map((task) =>
            task.id === id ? { ...task, deletedAt: '2020-01-01T00:00:00.000Z' } : task,
          ),
        },
      };
    });
    await store.getState().flush();
    const engine = createSyncEngine({
      transport,
      workspace: store,
      storage: createMemoryStorage(),
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id);
    await renderApp('/trash', store, engine);

    expect(task()?.deletedAt).toBe('2020-01-01T00:00:00.000Z');
    release();
    await waitFor(() => expect(engine.getState().lastSynced).not.toBeNull());
    await waitFor(() => expect(task() && isPurged(task()!)).toBe(true));
  });

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
