import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
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
      next = createTask(ctx, next, { title, listId: inboxList(next).id }).workspace;
    }
    return next;
  });
  await screen.findByRole('button', { name: `Open ${titles[0]!}` });
  const task = (title: string) =>
    store.getState().workspace!.entities.tasks.find((each) => each.title === title)!;
  return { task };
}

describe('keyboard shortcuts', () => {
  it('? lists them; G then a key goes places', async () => {
    await inboxWith('Mow');
    await userEvent.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Add a task')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.keyboard('gt');
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    await userEvent.keyboard('gs');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('Q focuses adding a task; letters typed there stay text', async () => {
    await inboxWith('Mow');
    await userEvent.keyboard('q');
    const field = screen.getByRole('textbox', { name: /Add task/ });
    expect(field).toHaveFocus();
    await userEvent.keyboard('gt');
    expect(field).toHaveValue('gt');
    expect(screen.getByRole('heading', { level: 1, name: 'Mess Drawer' })).toBeInTheDocument();
  });

  it('J and K step through tasks; Space completes, E edits, Delete trashes', async () => {
    const { task } = await inboxWith('Mow', 'Rake', 'Weed');
    await userEvent.keyboard('j');
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Mow' })).toHaveFocus();
    await userEvent.keyboard('j');
    expect(screen.getByRole('button', { name: 'Open Rake' })).toHaveFocus();
    await userEvent.keyboard('k');
    expect(screen.getByRole('button', { name: 'Open Mow' })).toHaveFocus();

    await userEvent.keyboard(' ');
    expect(task('Mow').status).toBe('done');
    await userEvent.keyboard(' ');
    expect(task('Mow').status).toBe('open');

    await userEvent.keyboard('e');
    const details = screen.getByRole('region', { name: 'Task details' });
    expect(within(details).getByRole('textbox', { name: 'Title' })).toHaveFocus();
    // Escape leaves the title and closes the details; J picks the first task again.
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('j');

    await userEvent.keyboard('{Delete}');
    expect(task('Mow').deletedAt).not.toBeNull();
    expect(await screen.findByText('Task deleted')).toBeInTheDocument();
  });
});
