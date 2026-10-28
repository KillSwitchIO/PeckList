import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function today() {
  const store = testStore();
  await store.getState().init();
  const day = todayIn(localTimeZone(), Date.now());
  const on = (date: string) => ({
    start: date,
    end: null,
    allDay: true,
    timeZone: localTimeZone(),
  });
  store.getState().apply((ctx, ws) => {
    let next: WorkspaceFile = ws;
    for (const [title, date] of [
      ['Old bill', addDays(day, -2)],
      ['Old call', addDays(day, -1)],
      ['Walk dog', day],
    ] as const) {
      next = createTask(ctx, next, {
        title,
        listId: inboxList(next).id,
        schedule: on(date),
      }).workspace;
    }
    return next;
  });
  await store.getState().flush();
  await renderApp('/today', store);
  const status = (title: string) =>
    store.getState().workspace!.entities.tasks.find((task) => task.title === title)!.status;
  return { status };
}

describe('picking many tasks', () => {
  it('Select turns boxes into circles; a section circle picks it all; the bar completes them', async () => {
    mockViewport('phone');
    const { status } = await today();
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Select' }));
    // The tabs give way to the actions.
    const bar = await screen.findByRole('toolbar', { name: 'Picked tasks' });
    expect(screen.queryByRole('navigation', { name: 'Punchlist' })).toBeNull();
    expect(within(bar).getByText('0 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Select all in Overdue/ }));
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Walk dog' }));
    expect(within(bar).getByText('3 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Old call' }));
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(status('Old bill')).toBe('done'));
    expect(status('Walk dog')).toBe('done');
    expect(status('Old call')).toBe('open');
    expect(screen.queryByRole('toolbar', { name: 'Picked tasks' })).toBeNull();
    expect(await screen.findByText('2 tasks changed')).toBeInTheDocument();
  });

  it('Select all picks every task shown, then turns into Deselect all (R-FB-124)', async () => {
    mockViewport('desktop');
    await today();
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Select' }));
    const bar = await screen.findByRole('toolbar', { name: 'Picked tasks' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Select all' }));
    expect(within(bar).getByText('3 selected')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Deselect all' }));
    expect(within(bar).getByText('0 selected')).toBeInTheDocument();
    // Still picking: one by one again, and Select all is back.
    expect(within(bar).getByRole('button', { name: 'Select all' })).toBeInTheDocument();
  });
});
