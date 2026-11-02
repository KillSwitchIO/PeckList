import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const rowDate = (title: string) =>
  within(screen.getByRole('button', { name: `Open ${title}` }).parentElement!).getByTestId(
    'task-date',
  );

describe('the day page (PL-094)', () => {
  it('does not repeat its own date on each row: a time stays, an all-day task shows none', async () => {
    const zone = localTimeZone();
    const day = addDays(todayIn(zone, Date.now()), 3);
    const store = testStore();
    await renderApp(`/day/${day}`, store);
    store.getState().apply((ctx, ws) => {
      const list = inboxList(ws).id;
      let next = createTask(ctx, ws, {
        title: 'Pick up the cake',
        listId: list,
        schedule: { start: day, end: null, allDay: true, timeZone: zone },
      }).workspace;
      next = createTask(ctx, next, {
        title: 'Call the vet',
        listId: list,
        schedule: { start: `${day}T17:00`, end: null, allDay: false, timeZone: zone },
      }).workspace;
      return next;
    });

    const allDay = await screen.findByRole('button', { name: 'Open Pick up the cake' });
    expect(allDay).toBeInTheDocument();
    // No date text, and no "add a date" icon either: the date is still there to edit.
    expect(rowDate('Pick up the cake')).toHaveTextContent(/^$/);
    expect(rowDate('Pick up the cake')).toHaveAccessibleName(/^Start date: /);
    expect(rowDate('Call the vet')).toHaveTextContent(/^5:00\s?PM$/);
  });
});
