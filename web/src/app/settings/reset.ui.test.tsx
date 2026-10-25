import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createList, inboxList } from '../../core/lists.ts';
import { createTag } from '../../core/tags.ts';
import { createTask } from '../../core/tasks.ts';
import { isPurged } from '../../core/trash.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function withSome() {
  const store = testStore();
  await renderApp('/settings', store);
  store.getState().apply((ctx, ws) => {
    const garden = createList(ctx, ws, { name: 'Garden', color: '#336699' });
    let next = createTask(ctx, garden.workspace, {
      title: 'Weed',
      listId: garden.list.id,
    }).workspace;
    next = createTask(ctx, next, { title: 'Loose', listId: inboxList(next).id }).workspace;
    return createTag(ctx, next, 'yard').workspace;
  });
  const live = () => {
    const ws = store.getState().workspace!;
    return {
      lists: ws.entities.lists.filter((each) => !each.deletedAt && !each.isInbox).length,
      tasks: ws.entities.tasks.filter((each) => !each.deletedAt).length,
      tags: ws.entities.tags.filter((each) => !each.deletedAt).length,
    };
  };
  return { store, live };
}

async function openReset() {
  const section = await screen.findByRole('region', { name: 'Start over' });
  await userEvent.click(
    within(section).getByRole('button', { name: 'Delete all lists, tasks and tags' }),
  );
  return { section, dialog: await screen.findByRole('dialog', { name: 'Start over?' }) };
}

describe('settings: start over', () => {
  it('moves every list, task and tag to the Trash, and undo brings them back', async () => {
    const { store, live } = await withSome();
    const { section, dialog } = await openReset();
    expect(dialog).toHaveTextContent('Your 1 lists, 2 tasks and 1 tags go to the Trash.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to the Trash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(section).toHaveTextContent('Moved 1 lists, 2 tasks and 1 tags to the Trash.');
    expect(live()).toEqual({ lists: 0, tasks: 0, tags: 0 });
    expect(store.getState().lastUndoable?.label).toBe('Everything moved to the Trash');
    store.getState().undo();
    expect(live()).toEqual({ lists: 1, tasks: 2, tags: 1 });
  });

  it('empties the Trash too when asked, after a warning', async () => {
    const { store, live } = await withSome();
    const { dialog } = await openReset();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Also empty the Trash' }));
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(live()).toEqual({ lists: 0, tasks: 0, tags: 0 });
    const tasks = store.getState().workspace!.entities.tasks;
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every(isPurged)).toBe(true);
  });

  it('cancel leaves everything', async () => {
    const { live } = await withSome();
    const { dialog } = await openReset();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(live()).toEqual({ lists: 1, tasks: 2, tags: 1 });
  });
});
