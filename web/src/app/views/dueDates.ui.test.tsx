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
  mockViewport('desktop');
});

const today = () => todayIn(localTimeZone(), Date.now());
const zone = () => localTimeZone();

function seed(store: ReturnType<typeof testStore>) {
  const day = today();
  store.getState().apply((ctx, ws) => {
    let next: WorkspaceFile = ws;
    const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]>) => {
      next = createTask(ctx, next, { title, listId: inboxList(next).id, ...extra }).workspace;
    };
    add('Late report', { due: { at: addDays(day, -2), allDay: true, timeZone: zone() } });
    add('Pay rent', {
      due: { at: `${addDays(day, 3)}T17:00`, allDay: false, timeZone: zone() },
      // A start too: the Due dates row still shows the due date.
      schedule: { start: addDays(day, 1), end: null, allDay: true, timeZone: zone() },
    });
    add('Renew passport', { due: { at: addDays(day, 40), allDay: true, timeZone: zone() } });
    add('No deadline', {
      schedule: { start: day, end: null, allDay: true, timeZone: zone() },
    });
    return next;
  });
}

const section = (name: RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;

describe('Due dates', () => {
  it('groups open tasks with a due date by deadline, showing the due date on the row', async () => {
    const store = testStore();
    await renderApp('/due', store);
    expect(screen.getByText('No open task has a due date.')).toBeInTheDocument();
    seed(store);
    expect(await screen.findByRole('heading', { level: 2, name: /^Overdue/ })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Overdue1', 'Due in the next 7 days1', 'Due later1']);
    expect(screen.queryByRole('button', { name: 'Open No deadline' })).toBeNull();
    const rent = screen.getByRole('button', { name: 'Open Pay rent' }).closest('li')!;
    expect(within(rent).getByTestId('task-date')).toHaveTextContent('5:00 PM');
  });

  it('selects tasks and moves their due dates together, keeping each time of day', async () => {
    const store = testStore();
    await renderApp('/due', store);
    seed(store);
    await screen.findByRole('heading', { level: 2, name: /^Overdue/ });
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Late report' }));
    // Tapping a row picks it too, instead of opening it.
    await userEvent.click(screen.getByRole('button', { name: 'Open Pay rent' }));
    const bar = screen.getByRole('toolbar', { name: 'Change due dates' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Tomorrow' }));

    expect(screen.queryByRole('toolbar', { name: 'Change due dates' })).toBeNull();
    const tomorrow = section(/^Due tomorrow/);
    expect(within(tomorrow).getByRole('button', { name: 'Open Late report' })).toBeInTheDocument();
    expect(within(tomorrow).getByRole('button', { name: 'Open Pay rent' })).toBeInTheDocument();
    const rent = store
      .getState()
      .workspace!.entities.tasks.find((task) => task.title === 'Pay rent')!;
    expect(rent.due?.at).toBe(`${addDays(today(), 1)}T17:00`);
  });

  it('selects a whole group and clears the due dates', async () => {
    const store = testStore();
    await renderApp('/due', store);
    seed(store);
    await screen.findByRole('heading', { level: 2, name: /^Due later/ });
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(
      within(section(/^Due later/)).getByRole('button', { name: 'Select all' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear due dates' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open Renew passport' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Open Late report' })).toBeInTheDocument();
  });

  it('sits in the sidebar with the other views', async () => {
    await renderApp('/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByRole('button', { name: 'Due dates' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Due dates' })).toBeInTheDocument();
  });
});

describe('Upcoming', () => {
  it('lists each coming day and adds a task straight to one', async () => {
    const store = testStore();
    await renderApp('/upcoming', store);
    const inThree = addDays(today(), 3);
    const day = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.closest('section')!)[3]!;
    const add = within(day).getByRole('button', { name: /^Add a task to / });
    await userEvent.click(add);
    await userEvent.type(within(day).getByRole('textbox'), 'Pick up parts{Enter}');
    expect(
      await within(day).findByRole('button', { name: 'Open Pick up parts' }),
    ).toBeInTheDocument();
    const task = store
      .getState()
      .workspace!.entities.tasks.find((each) => each.title === 'Pick up parts')!;
    expect(task.schedule?.start).toBe(inThree);
  });

  it('steps through weeks from the strip, back into the past, and home to today', async () => {
    const store = testStore();
    await store.getState().init();
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title: 'Old chore',
          listId: inboxList(ws).id,
          schedule: { start: addDays(today(), -2), end: null, allDay: true, timeZone: zone() },
        }).workspace,
    );
    await store.getState().flush();
    await renderApp('/upcoming', store);
    const strip = () => screen.getByRole('group', { name: 'Days of the week' });
    const todayButton = () =>
      within(strip().parentElement!.parentElement!.parentElement!).getByRole('button', {
        name: 'Today',
      });
    expect(within(strip()).getByRole('button', { name: /Today/ })).toHaveAttribute(
      'aria-current',
      'date',
    );
    expect(todayButton()).toBeDisabled();
    expect(screen.getByRole('heading', { name: /Overdue/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(within(strip()).queryByRole('button', { name: /Today/ })).toBeNull();
    expect(todayButton()).toBeEnabled();

    // Earlier than today: the list starts there, with no Overdue group.
    await userEvent.click(todayButton());
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    // The same weekday, a week back: the list starts there.
    expect(document.querySelector('[data-agenda-day]')).toHaveAttribute(
      'data-agenda-day',
      addDays(today(), -7),
    );
    expect(screen.queryByRole('heading', { name: /Overdue/ })).toBeNull();

    await userEvent.click(todayButton());
    expect(within(strip()).getByRole('button', { name: /Today/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('heading', { name: /Overdue/ })).toBeInTheDocument();
  });

  it('starts from an older day picked on the month, and loads more days at the end', async () => {
    await renderApp('/upcoming');
    const days = () => document.querySelectorAll('[data-agenda-day]').length;
    expect(days()).toBe(14);
    await userEvent.click(screen.getByRole('button', { name: 'Show more days' }));
    expect(days()).toBe(28);

    await userEvent.click(screen.getByRole('button', { name: /pick a day to start from/ }));
    const picker = await screen.findByRole('grid');
    const weekAgo = addDays(today(), -7);
    const cell = picker.querySelector(`[data-date="${weekAgo}"]`) as HTMLElement | null;
    // A week ago may sit in the month before: step back to it.
    if (!cell) await userEvent.click(screen.getByRole('button', { name: /previous month/i }));
    await userEvent.click(document.querySelector(`[data-date="${weekAgo}"]`) as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector('[data-agenda-day]')).toHaveAttribute(
        'data-agenda-day',
        weekAgo,
      ),
    );
    // Everything loaded before stays.
    expect(days()).toBe(35);
  });
});
