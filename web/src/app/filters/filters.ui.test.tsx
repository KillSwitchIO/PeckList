import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createSavedFilter, DUE_CHOICES, filterOf } from '../../core/savedFilters.ts';
import { createTask, setTaskStatus } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('saved filters', () => {
  it('count their tasks in the sidebar and edit due date and closed tasks', async () => {
    const store = testStore();
    await renderApp('/today', store);
    const today = todayIn(localTimeZone(), Date.now());
    store.getState().apply((ctx, ws) => {
      const listId = inboxList(ws).id;
      const due = (days: number) => ({ at: addDays(today, days), allDay: true, timeZone: 'UTC' });
      let next = createTask(ctx, ws, { title: 'Pay rent', listId, due: due(-2) }).workspace;
      next = createTask(ctx, next, { title: 'Renew passport', listId, due: due(-1) }).workspace;
      next = createTask(ctx, next, { title: 'Plan trip', listId, due: due(30) }).workspace;
      const old = createTask(ctx, next, { title: 'Old bill', listId, due: due(-5) });
      next = setTaskStatus(ctx, old.workspace, old.task.id, 'done');
      return createSavedFilter(ctx, next, 'Late', DUE_CHOICES.overdue).workspace;
    });
    const nav = screen.getAllByRole('navigation')[0]!;
    const row = await within(nav).findByRole('button', { name: /Late/ });
    expect(row).toHaveTextContent('2');

    await userEvent.click(row);
    expect(await screen.findByRole('button', { name: 'Open Pay rent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Plan trip' })).toBeNull();
    expect(screen.getByText('Old bill')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit filter' }));
    const dialog = await screen.findByRole('dialog');
    const due = within(dialog).getByRole('group', { name: 'Due date' });
    expect(within(due).getByRole('button', { name: 'Overdue' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Show closed tasks' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByText('Old bill')).toBeNull());
    const saved = store.getState().workspace!.entities.savedFilters[0]!;
    expect(filterOf(saved)).toEqual({ due: { to: -1 }, closed: false });
  });
});
