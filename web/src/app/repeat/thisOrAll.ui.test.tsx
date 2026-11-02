import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => localStorage.clear());

/** A weekly task starting tomorrow, Upcoming open, its next week's date opened. */
async function openNextWeek() {
  const store = testStore();
  await renderApp('/upcoming', store);
  const today = todayIn(localTimeZone(), Date.now());
  let id = '';
  store.getState().apply((ctx, ws) => {
    const made = createTask(ctx, ws, {
      title: 'Therapy',
      listId: inboxList(ws).id,
      schedule: { start: addDays(today, 1), end: null, allDay: true, timeZone: localTimeZone() },
      recurrence: 'FREQ=WEEKLY',
    });
    id = made.task.id;
    return made.workspace;
  });
  const [next] = await screen.findAllByRole(
    'button',
    { name: /^Therapy, repeats on/ },
    { timeout: 5000 },
  );
  await userEvent.click(next!);
  await screen.findByText(/^Showing .*, a date to come/, undefined, { timeout: 5000 });
  const tasks = () =>
    store
      .getState()
      .workspace!.entities.tasks.filter(
        (task) => task.title === 'Therapy' && task.deletedAt === null,
      );
  return { id, today, tasks, series: () => tasks().find((task) => task.id === id) };
}

describe('a repeating task asks: just this date, or all of them (PL-060)', () => {
  it('deletes just the date opened, leaving the series', async () => {
    const { today, series } = await openNextWeek();
    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    const ask = await screen.findByRole('dialog', { name: 'Delete a repeating task' });
    await userEvent.click(within(ask).getByRole('button', { name: /^Just / }));
    await waitFor(() =>
      expect(series()?.recurrence).toBe(
        `FREQ=WEEKLY;X-PL-SKIP=${addDays(today, 8).replace(/-/g, '')}`,
      ),
    );
  });

  it('deletes every date when asked to', async () => {
    const { series } = await openNextWeek();
    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    const ask = await screen.findByRole('dialog', { name: 'Delete a repeating task' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Every date' }));
    await waitFor(() => expect(series()).toBeUndefined());
  });

  it('backing out changes nothing', async () => {
    const { series } = await openNextWeek();
    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    const ask = await screen.findByRole('dialog', { name: 'Delete a repeating task' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(series()?.recurrence).toBe('FREQ=WEEKLY');
  });
});
