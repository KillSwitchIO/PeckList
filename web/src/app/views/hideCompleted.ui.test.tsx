import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask, setTaskStatus } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** The Closed group's header in the page (the sidebar has a Closed view too). */
const closedHeader = () =>
  within(screen.getByRole('main')).queryByRole('button', { name: /^Closed \d+$/ });

async function withDoneTask(path: string) {
  const store = testStore();
  await renderApp(path, store);
  store.getState().apply((ctx, ws) => {
    const made = createTask(ctx, ws, { title: 'Water the plants', listId: inboxList(ws).id });
    return setTaskStatus(ctx, made.workspace, made.task.id, 'done');
  });
}

describe('hiding the Closed group (R-FB-159)', () => {
  it('a right-click (or long press) on its header hides it on this device', async () => {
    await withDoneTask('/inbox');
    const header = await waitFor(() => {
      const found = closedHeader();
      expect(found).not.toBeNull();
      return found!;
    });

    fireEvent.contextMenu(header);
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('Hide the Closed group'));
    await waitFor(() => expect(closedHeader()).toBeNull());
    expect(screen.queryByRole('button', { name: 'Open Water the plants' })).toBeNull();
    expect(localStorage.getItem('pecklist.hideCompleted')).toBe('true');
  });

  it('the Closed view still lists closed tasks while the group is hidden', async () => {
    localStorage.setItem('pecklist.hideCompleted', 'true');
    await withDoneTask('/completed');
    expect(
      await screen.findByRole('button', { name: 'Open Water the plants' }),
    ).toBeInTheDocument();
  });

  it('Settings shows it again', async () => {
    localStorage.setItem('pecklist.hideCompleted', 'true');
    await renderApp('/settings/tasks', testStore());
    const toggle = await screen.findByRole(
      'switch',
      { name: 'Show the Closed group' },
      { timeout: 10_000 },
    );
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(localStorage.getItem('pecklist.hideCompleted')).toBeNull();
    expect(toggle).toBeChecked();
  });
});
