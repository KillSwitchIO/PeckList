import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function calendarWith() {
  const store = testStore();
  await store.getState().init();
  const zone = localTimeZone();
  const today = todayIn(zone, Date.now());
  store.getState().apply((ctx, ws) => {
    const inbox = inboxList(ws).id;
    let next = createTask(ctx, ws, {
      title: 'Dentist',
      listId: inbox,
      schedule: { start: today, end: null, allDay: true, timeZone: zone },
      due: { at: today, allDay: true, timeZone: zone },
    }).workspace;
    next = createTask(ctx, next, { title: 'Someday', listId: inbox }).workspace;
    return next;
  });
  await store.getState().flush();
  await renderApp('/calendar', store);
  return { store };
}

describe('calendar', () => {
  it('shows scheduled tasks with their due flags, and unscheduled ones to drag in', async () => {
    await calendarWith();
    expect(await screen.findByRole('heading', { level: 2 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Dentist').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByTitle('Due: Dentist')).toBeInTheDocument();
    const waiting = screen.getByRole('list', { name: 'Unscheduled' });
    const someday = within(waiting).getByRole('listitem');
    expect(someday).toHaveTextContent('Someday');
    expect(someday).toHaveAttribute('data-task-id');
  });

  it('switches between month, week and day and remembers the choice', async () => {
    await calendarWith();
    const modes = await screen.findByRole('group', { name: 'Calendar view' });
    await userEvent.click(within(modes).getByRole('button', { name: 'Week' }));
    expect(localStorage.getItem('punchlist.calendar.mode')).toBe('week');
    await userEvent.click(within(modes).getByRole('button', { name: 'Day' }));
    const title = screen.getByRole('heading', { level: 2 }).textContent;
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(title);
    await userEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(title);
  });

  it('opens a task from the calendar', async () => {
    await calendarWith();
    await waitFor(() => expect(screen.getAllByText('Dentist').length).toBeGreaterThanOrEqual(1));
    await userEvent.click(screen.getAllByText('Dentist')[0]!);
    expect(await screen.findByRole('textbox', { name: /title/i })).toHaveValue('Dentist');
  });
});
