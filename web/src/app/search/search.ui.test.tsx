import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask, setTaskStatus, updateTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function withTasks(path: string) {
  const store = testStore();
  const result = await renderApp(path, store);
  store.getState().apply((ctx, ws) => {
    const listId = inboxList(ws).id;
    const fence = createTask(ctx, ws, { title: 'Paint the fence', listId });
    const shed = createTask(ctx, fence.workspace, { title: 'Tidy shed', listId });
    const notes = updateTask(ctx, shed.workspace, shed.task.id, {
      notes: 'Then paint it green',
    });
    const old = createTask(ctx, notes, { title: 'Paint the door', listId });
    return setTaskStatus(ctx, old.workspace, old.task.id, 'done');
  });
  return result;
}

describe('search', () => {
  it('"/" opens search; words match titles and notes, with matches marked', async () => {
    await withTasks('/today');
    await userEvent.keyboard('/');
    const field = await screen.findByRole('searchbox', { name: 'Search tasks' });
    expect(field).toHaveFocus();
    expect(screen.getByText('Find any task')).toBeInTheDocument();

    await userEvent.type(field, 'paint');
    const results = await screen.findByRole('list', { name: 'Search results' });
    const rows = within(results).getAllByRole('button', { name: /^Open / });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Open Paint the fence',
      'Open Tidy shed',
    ]);
    // The match is marked in the title and in the notes snippet.
    expect(within(results).getAllByText('Paint', { selector: 'mark' })).toHaveLength(1);
    expect(within(results).getByText('paint', { selector: 'mark' })).toBeInTheDocument();
    // Closed tasks come in their own group.
    expect(screen.getByRole('button', { name: 'Open Paint the door' })).toBeInTheDocument();

    await userEvent.click(rows[1]!);
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeInTheDocument();
  });

  it('says when nothing matches, and keeps the query in the address', async () => {
    await withTasks('/search?q=fence%20blue');
    expect(await screen.findByText('Nothing matches "fence blue".')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('fence blue');
  });

  it('"/" types normally inside a text field', async () => {
    await withTasks('/inbox');
    const add = await screen.findByRole('textbox', { name: /Add task/ });
    await userEvent.type(add, 'a/b');
    expect(add).toHaveValue('a/b');
    expect(screen.queryByRole('searchbox', { name: 'Search tasks' })).toBeNull();
  });
});
