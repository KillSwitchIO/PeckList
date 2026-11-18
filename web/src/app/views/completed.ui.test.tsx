import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask, setCompletedAt, setTaskStatus, updateTask } from '../../core/tasks.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const slow = { timeout: 10_000 };
/** Someone else, by an id as the data wants one. */
const KIM = '01JKMMMMMMMMMMMMMMMMMMMMMM';

interface Seed {
  title: string;
  daysAgo: number;
  wontDo?: boolean;
  by?: string;
}

/** Tasks closed some days ago, at noon there, then the app at `path`. */
async function appWith(seeds: Seed[], path = '/completed') {
  const store = testStore();
  await store.getState().init();
  const today = todayIn(localTimeZone(), Date.now());
  store.getState().apply((ctx, ws) => {
    let workspace: WorkspaceFile = ws;
    for (const seed of seeds) {
      const made = createTask(ctx, workspace, { title: seed.title, listId: inboxList(ws).id });
      const at = new Date(`${addDays(today, -seed.daysAgo)}T12:00:00`).toISOString();
      workspace = updateTask(ctx, made.workspace, made.task.id, { completedAt: at });
      workspace = seed.wontDo
        ? setTaskStatus(ctx, workspace, made.task.id, 'wontdo')
        : setCompletedAt(ctx, workspace, made.task.id, at);
      if (seed.by) workspace = updateTask(ctx, workspace, made.task.id, { completedBy: seed.by });
    }
    return workspace;
  });
  await store.getState().flush();
  await renderApp(path, store);
  return { store, today };
}

const week = [
  { title: 'Pay rent', daysAgo: 0 },
  { title: 'Water plants', daysAgo: 0 },
  { title: 'Skip the gym', daysAgo: 0, wontDo: true },
  { title: 'Call mom', daysAgo: 1 },
  { title: 'Clean the gutters', daysAgo: 3 },
];

/** The number over one of the totals. */
const total = (label: string) =>
  within(screen.getByRole('group', { name: 'Totals' })).getByText(label).previousElementSibling
    ?.textContent;

describe('the Completed page', () => {
  it('is in the sidebar as Completed', async () => {
    await appWith(week, '/today');
    // Completed and Trash sit in the "More" group, closed at first.
    const nav = (await screen.findAllByRole('navigation', {}, slow))[0]!;
    await userEvent.click(within(nav).getByRole('button', { name: /^More/ }));
    await userEvent.click(within(nav).getByText('Completed'));
    expect(await screen.findByRole('heading', { name: 'Completed', level: 1 })).toBeInTheDocument();
  });

  it('shades each day by what was done, with the totals; won’t do is listed but not counted', async () => {
    await appWith(week);
    const heatmap = await screen.findByRole('region', { name: 'Completed tasks per day' }, slow);
    expect(within(heatmap).getByRole('button', { name: 'Today, 2 tasks completed' })).toBeVisible();
    expect(
      within(heatmap).getByRole('button', { name: 'Yesterday, 1 task completed' }),
    ).toBeVisible();
    // The busiest day is the darkest.
    expect(within(heatmap).getByRole('button', { name: /^Today,/ })).toHaveAttribute(
      'data-heat',
      '3',
    );
    expect(total('Today')).toBe('2');
    expect(total('Days in a row')).toBe('2');
    // Every closed task by its day, won't do too.
    for (const title of [
      'Pay rent',
      'Water plants',
      'Skip the gym',
      'Call mom',
      'Clean the gutters',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText(/Completed tasks stay 30 days/)).toBeInTheDocument();
  });

  it('a day on the heatmap shows that day only, and Show all the rest again', async () => {
    await appWith(week);
    const heatmap = await screen.findByRole('region', { name: 'Completed tasks per day' }, slow);
    await userEvent.click(within(heatmap).getByRole('button', { name: /^Yesterday,/ }));
    expect(screen.getByRole('heading', { name: 'Completed on Yesterday' })).toBeInTheDocument();
    expect(screen.getByText('Call mom')).toBeInTheDocument();
    expect(screen.queryByText('Pay rent')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByText('Pay rent')).toBeInTheDocument();
  });

  it('the heatmap is one tab stop, and the arrow keys move through the days', async () => {
    await appWith(week);
    const heatmap = await screen.findByRole('region', { name: 'Completed tasks per day' }, slow);
    const stops = within(heatmap)
      .getAllByRole('button')
      .filter((day) => day.tabIndex === 0);
    expect(stops.map((day) => day.getAttribute('aria-label'))).toEqual([
      'Today, 2 tasks completed',
    ]);
    stops[0]!.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toHaveAccessibleName('Yesterday, 1 task completed');
    expect(document.activeElement).toHaveAttribute('tabindex', '0');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Completed on Yesterday' })).toBeInTheDocument();
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toHaveAccessibleName(/^Today,/);
  });

  it('done tasks in the Trash still count, and the day says where they are', async () => {
    const { store } = await appWith(week);
    const rent = store
      .getState()
      .workspace!.entities.tasks.find((task) => task.title === 'Pay rent')!;
    store
      .getState()
      .apply((ctx, ws) => updateTask(ctx, ws, rent.id, { deletedAt: new Date().toISOString() }));
    const heatmap = await screen.findByRole('region', { name: 'Completed tasks per day' }, slow);
    await userEvent.click(
      within(heatmap).getByRole('button', { name: 'Today, 2 tasks completed' }),
    );
    expect(screen.queryByText('Pay rent')).toBeNull();
    expect(screen.getByText('1 more is in the Trash.')).toBeInTheDocument();
  });

  it('with someone else’s completions: who completed them narrows the page', async () => {
    await appWith([...week, { title: 'Mow the lawn', daysAgo: 0, by: KIM }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Completed by' }, slow));
    const people = screen.getAllByRole('menuitem');
    expect(people[0]).toHaveTextContent('Anyone');
    expect(people).toHaveLength(3);
    // Me first, then Kim.
    await userEvent.click(people[2]!);
    await waitFor(() => expect(screen.queryByText('Pay rent')).toBeNull());
    expect(screen.getByText('Mow the lawn')).toBeInTheDocument();
    expect(total('Today')).toBe('1');
  });

  it('no Completed by button when only I complete things', async () => {
    await appWith(week);
    await screen.findByRole('region', { name: 'Completed tasks per day' }, slow);
    expect(screen.queryByRole('button', { name: 'Completed by' })).toBeNull();
  });
});

describe('Show completed on the calendar', () => {
  it('off at first; on, each day in Month says how many were done, and it stays on', async () => {
    const { today } = await appWith(week, '/calendar');
    await screen.findAllByRole('grid', {}, slow);
    expect(screen.queryByRole('img', { name: '1 task completed' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }));
    const yesterday = document.querySelector(`[data-cal-day="${addDays(today, -1)}"]`)!;
    expect(
      within(yesterday as HTMLElement).getByRole('img', { name: '1 task completed' }),
    ).toBeVisible();
    const day = document.querySelector(`[data-cal-day="${today}"]`)!;
    expect(
      within(day as HTMLElement).getByRole('img', { name: '2 tasks completed' }),
    ).toBeVisible();
    expect(JSON.parse(localStorage.getItem('pecklist.calendar')!)).toMatchObject({
      completed: true,
    });
  });
});
