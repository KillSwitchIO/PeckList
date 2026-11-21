import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createList, inboxList } from '../../core/lists.ts';
import { createTask, deleteTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function inboxWith(...titles: string[]) {
  const store = testStore();
  await renderApp('/inbox', store);
  store.getState().apply((ctx, ws) => {
    let next = ws;
    for (const title of titles) {
      next = createTask(ctx, next, { title, listId: inboxList(next).id, priority: 2 }).workspace;
    }
    return next;
  });
  await screen.findByRole('button', { name: `Open ${titles[0]!}` });
  const rows = () =>
    screen.getAllByRole('button', { name: /^Open / }).map((row) => row.textContent ?? '');
  const tasks = () => store.getState().workspace!.entities.tasks.filter((each) => !each.deletedAt);
  return { store, rows, tasks };
}

describe('duplicating a task (PL-139)', () => {
  it('copies it from its menu, right below, opened with the title selected; Undo takes it back', async () => {
    const { rows, tasks } = await inboxWith('Mow', 'Rake');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Mow' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(rows()).toEqual(['Mow', 'Mow', 'Rake']));
    expect(
      tasks()
        .filter((each) => each.title === 'Mow')
        .map((each) => each.priority),
    ).toEqual([2, 2]);
    expect(screen.getByText('Task duplicated')).toBeInTheDocument();

    const details = await screen.findByRole('region', { name: 'Task details' });
    const title = within(details).getByRole<HTMLTextAreaElement>('textbox', { name: 'Title' });
    await waitFor(() => expect(title).toHaveFocus());
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, 3]);

    // Typing renames the copy (the open one), not the original.
    await userEvent.keyboard('Mow the back{Enter}');
    await waitFor(() => expect(rows()).toEqual(['Mow', 'Mow the back', 'Rake']));

    // A title edit has no Undo of its own: Undo takes the whole copy back.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(rows()).toEqual(['Mow', 'Rake']));
    // And the copy's details close with it, rather than saying it no longer exists.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull());
    expect(screen.queryByText('This task no longer exists.')).toBeNull();
  });

  it('a copy opened again later says it is gone when deleted elsewhere', async () => {
    // Closing only on Undo is for the opening that made the copy, not every later one.
    const { store, rows } = await inboxWith('Mow');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Mow' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(rows()).toEqual(['Mow', 'Mow']));
    await screen.findByRole('region', { name: 'Task details' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull());

    // Some time later, the copy opened from its row, then deleted on another device.
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000);
    try {
      const copy = store
        .getState()
        .workspace!.entities.tasks.filter((each) => each.title === 'Mow')
        .at(-1)!;
      await userEvent.click(screen.getAllByRole('button', { name: 'Open Mow' })[1]!);
      await screen.findByRole('region', { name: 'Task details' });
      store.getState().apply((ctx, ws) => deleteTask(ctx, ws, copy.id));
      expect(await screen.findByText('This task no longer exists.')).toBeInTheDocument();
    } finally {
      later.mockRestore();
    }
  });

  it('D duplicates the open task', async () => {
    const { rows } = await inboxWith('Mow', 'Rake');
    await userEvent.keyboard('j');
    await screen.findByRole('region', { name: 'Task details' });
    await userEvent.keyboard('d');
    await waitFor(() => expect(rows()).toEqual(['Mow', 'Mow', 'Rake']));
    expect(screen.getByText('Task duplicated')).toBeInTheDocument();
  });

  it('copies the picked tasks from the bar, each below its own, as one change', async () => {
    const { rows } = await inboxWith('Mow', 'Rake', 'Weed');
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Select' }));
    const bar = await screen.findByRole('toolbar', { name: 'Picked tasks' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Mow' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Weed' }));
    await userEvent.click(within(bar).getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(rows()).toEqual(['Mow', 'Mow', 'Rake', 'Weed', 'Weed']));
    expect(screen.getByText('2 tasks duplicated')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Picked tasks' })).toBeNull();
    // Nothing opens for several.
    expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(rows()).toEqual(['Mow', 'Rake', 'Weed']));
  });

  it('pins from the bar’s More menu', async () => {
    const { tasks } = await inboxWith('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Select' }));
    const bar = await screen.findByRole('toolbar', { name: 'Picked tasks' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Mow' }));
    await userEvent.click(within(bar).getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }));
    await waitFor(() => expect(tasks()[0]!.pinnedAt).toBeTruthy());
  });
});

describe('duplicating a list (PL-139)', () => {
  it('makes a private copy with its open tasks and goes to it', async () => {
    const store = testStore();
    await store.getState().init();
    let listId = '';
    store.getState().apply((ctx, ws) => {
      const made = createList(ctx, ws, { name: 'Garden', color: '#2e7d32' });
      listId = made.list.id;
      let next = createTask(ctx, made.workspace, { title: 'Weed', listId }).workspace;
      next = createTask(ctx, next, { title: 'Water', listId }).workspace;
      return next;
    });
    await store.getState().flush();
    await renderApp(`/lists/${listId}`, store);
    await screen.findByRole('button', { name: 'Open Weed' });
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate list' }));
    expect(await screen.findByRole('heading', { name: 'Garden (copy)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Open / }).map((row) => row.textContent)).toEqual(
      ['Weed', 'Water'],
    );
    expect(screen.getByText('List duplicated')).toBeInTheDocument();
    const lists = store.getState().workspace!.entities.lists.filter((each) => !each.deletedAt);
    expect(lists.find((each) => each.name === 'Garden (copy)')).toMatchObject({
      visibility: 'private',
      color: '#2e7d32',
    });

    // Undo takes the copy away and goes back to the list it came from, not to a missing list.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { name: 'Garden' })).toBeInTheDocument();
    expect(screen.queryByText('This list no longer exists.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Open / }).map((row) => row.textContent)).toEqual(
      ['Weed', 'Water'],
    );
    expect(
      store
        .getState()
        .workspace!.entities.lists.filter(
          (each) => !each.deletedAt && each.name === 'Garden (copy)',
        ),
    ).toEqual([]);
  });
});
