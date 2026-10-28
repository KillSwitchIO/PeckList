import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask, setTaskStatus } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const today = () => todayIn(localTimeZone(), Date.now());

describe('feedback 2026-10-28 (second round)', () => {
  it('Today is all punched out once nothing is open, with today’s completed tasks still listed', async () => {
    const store = testStore();
    await renderApp('/today', store);
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, {
        title: 'Walk the dog',
        listId: inboxList(ws).id,
        schedule: { start: today(), end: null, allDay: true, timeZone: localTimeZone() },
      });
      return setTaskStatus(ctx, made.workspace, made.task.id, 'done');
    });
    expect(await screen.findByText('All punched out.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open Walk the dog' })).toBeInTheDocument();
  });

  it('a task over several days shows its start and its end', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    const start = addDays(today(), 2);
    const end = addDays(today(), 5);
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title: 'Paint the house',
          listId: inboxList(ws).id,
          schedule: { start, end, allDay: true, timeZone: localTimeZone() },
        }).workspace,
    );
    const span = await screen.findByTestId('task-date-span');
    expect(within(span).getAllByText(/\S/)).toHaveLength(2);
    expect(span.textContent).toContain(' -');
  });
});
