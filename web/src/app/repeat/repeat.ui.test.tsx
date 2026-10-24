import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn, weekday } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

function addTask(store: ReturnType<typeof testStore>, title: string, start?: string) {
  let id = '';
  act(() =>
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, {
        title,
        listId: inboxList(ws).id,
        ...(start
          ? { schedule: { start, end: null, allDay: true, timeZone: localTimeZone() } }
          : {}),
      });
      id = made.task.id;
      return made.workspace;
    }),
  );
  return id;
}

describe('repeating tasks', () => {
  it('are set from the details, start today without a date, and move on when done', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    const today = todayIn(localTimeZone(), Date.now());
    const id = addTask(store, 'Water plants');
    await userEvent.click(screen.getByRole('button', { name: 'Open Water plants' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Repeat: None' }));
    const sheet = await screen.findByRole('dialog', { name: 'Repeat' });
    expect(within(sheet).getByText(/starts today/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('menuitem', { name: 'Daily' }));
    const tasks = () => store.getState().workspace!.entities.tasks;
    const task = () => tasks().find((each) => each.id === id)!;
    expect(task()).toMatchObject({ recurrence: 'FREQ=DAILY', schedule: { start: today } });
    expect(within(details).getByRole('button', { name: 'Repeat: Daily' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Repeats' }).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('checkbox', { name: 'Complete Water plants' })[0]!);
    expect(task()).toMatchObject({ status: 'open', schedule: { start: addDays(today, 1) } });
    const done = tasks().filter((each) => each.title === 'Water plants' && each.status === 'done');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ recurrence: null, schedule: { start: today } });
  });

  it('take a custom rule: every 2 weeks on chosen days, a few times, or from completion', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    // A Monday, so Monday is already chosen.
    let monday = todayIn(localTimeZone(), Date.now());
    while (weekday(monday) !== 1) monday = addDays(monday, 1);
    const id = addTask(store, 'Gym', monday);
    await userEvent.click(screen.getByRole('button', { name: 'Open Gym' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Repeat: None' }));
    let sheet = await screen.findByRole('dialog', { name: 'Repeat' });
    expect(within(sheet).getByRole('menuitem', { name: 'Weekly on Monday' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('menuitem', { name: 'Custom' }));
    const interval = within(sheet).getByRole('spinbutton', { name: 'How many' });
    await userEvent.clear(interval);
    await userEvent.type(interval, '2');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Thursday' }));
    await userEvent.click(within(sheet).getByRole('combobox', { name: 'Ends' }));
    await userEvent.click(await screen.findByRole('option', { name: 'After a number of times' }));
    const count = within(sheet).getByRole('spinbutton', { name: 'Times' });
    await userEvent.clear(count);
    await userEvent.type(count, '6');
    expect(within(sheet).getByText('Every 2 weeks on Mon, Thu, 6 more times')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
    expect(task().recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=6');

    // Reopened, the custom form shows the rule; from completion drops the weekdays.
    await userEvent.click(within(details).getByRole('button', { name: /^Repeat: Every 2 weeks/ }));
    sheet = await screen.findByRole('dialog', { name: 'Repeat' });
    await userEvent.click(within(sheet).getByRole('menuitem', { name: 'Custom' }));
    expect(within(sheet).getByRole('button', { name: 'Thursday' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(sheet).getByRole('switch', { name: /Count from when/ }));
    expect(within(sheet).queryByRole('button', { name: 'Thursday' })).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(task().recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;COUNT=6;X-PL-FROM=COMPLETION');
  });
});
