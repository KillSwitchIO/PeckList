import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { createTag } from '../../core/tags.ts';
import { createTask, setTaskStatus } from '../../core/tasks.ts';
import type { Schedule } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const today = () => todayIn(localTimeZone(), Date.now());
const on = (date: string): Schedule => ({ start: date, end: null, allDay: true, timeZone: 'UTC' });

/**
 * Mess Drawer: overdue, today, tomorrow, in 4 days, in 30 days, undated, 6 completed.
 * List "Work": one undated task. Tag "home" on "today" and "undated".
 */
async function renderSeeded(path: string) {
  const store = testStore();
  const result = await renderApp(path, store);
  const day = today();
  store.getState().apply((ctx, ws) => {
    const inbox = inboxList(ws).id;
    const work = createList(ctx, ws, { name: 'Work', color: '#A7C7E7' });
    const tag = createTag(ctx, work.workspace, 'home', '#A8DCC0');
    let next = tag.workspace;
    const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]> = {}) => {
      const created = createTask(ctx, next, { title, listId: inbox, ...extra });
      next = created.workspace;
      return created.task;
    };
    add('overdue', { schedule: on(addDays(day, -2)) });
    add('today', { schedule: on(day), tags: [tag.tag.id] });
    add('tomorrow', { schedule: on(addDays(day, 1)) });
    add('in four days', { schedule: on(addDays(day, 4)) });
    add('next month', { schedule: on(addDays(day, 30)) });
    add('undated', { tags: [tag.tag.id] });
    add('work thing', { listId: work.list.id });
    for (let i = 1; i <= 6; i += 1) {
      const done = add(`done ${i}`);
      next = setTaskStatus(ctx, next, done.id, 'done');
    }
    return next;
  });
  await waitFor(() =>
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0),
  );
  return result;
}

const groupHeadings = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

describe('date-grouped views', () => {
  it('All shows every open task in date groups, then Completed with View more', async () => {
    await renderSeeded('/all');
    await screen.findByRole('button', { name: 'Open work thing' });
    const headings = groupHeadings();
    expect(headings[0]).toMatch(/^Overdue/);
    expect(headings[1]).toMatch(/Today/);
    expect(headings[2]).toMatch(/Tomorrow/);
    expect(headings.slice(3)).toEqual(['Next 7 days1', 'Later1', 'No date2', 'Closed6']);
    // Only the last five completed, then View more.
    expect(screen.getAllByRole('checkbox', { name: /^Reopen done/ })).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'View more' }));
    expect(screen.getAllByRole('checkbox', { name: /^Reopen done/ })).toHaveLength(6);
    // View less sits in the Completed header and goes back to five.
    expect(screen.queryByRole('button', { name: 'View more' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'View less' }));
    expect(screen.getAllByRole('checkbox', { name: /^Reopen done/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'View less' })).toBeNull();
  });

  it('a list shows only its own tasks, grouped by date with No date', async () => {
    await renderSeeded('/inbox');
    await screen.findByRole('button', { name: 'Open undated' });
    expect(screen.queryByRole('button', { name: 'Open work thing' })).toBeNull();
    expect(groupHeadings()).toContain('No date1');
  });

  it('a tag shows its tasks grouped by date', async () => {
    await renderSeeded('/today');
    await userEvent.click(within(screen.getByRole('list', { name: 'Tags' })).getByText('home'));
    await screen.findByRole('heading', { level: 1, name: 'home' });
    const headings = groupHeadings();
    expect(headings[0]).toMatch(/Today1$/);
    expect(headings[1]).toBe('No date1');
  });

  it('Today and Next 7 days leave undated tasks out', async () => {
    await renderSeeded('/upcoming');
    await screen.findByRole('button', { name: 'Open in four days' });
    expect(screen.queryByRole('button', { name: 'Open undated' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open next month' })).toBeNull();
  });
});

describe('list sort and group options', () => {
  it('groups a list by tag or not at all, and sorts by title', async () => {
    await renderSeeded('/inbox');
    await screen.findByRole('button', { name: 'Open undated' });
    await userEvent.click(screen.getByRole('button', { name: 'Sort and group' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Group by tag' }));
    expect(groupHeadings()).toEqual(expect.arrayContaining(['home2', 'No tags4']));

    await userEvent.click(screen.getByRole('button', { name: 'Sort and group' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Group by none' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sort and group' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sort by title' }));
    const titles = screen
      .getAllByRole('button', { name: /^Open / })
      .map((row) => row.getAttribute('aria-label')!.slice(5))
      .filter((title) => !title.startsWith('done'));
    expect(titles).toEqual([
      'in four days',
      'next month',
      'overdue',
      'today',
      'tomorrow',
      'undated',
    ]);

    // Remembered for the list.
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByRole('button', { name: /^Today/ }));
    await userEvent.click(within(nav).getByRole('button', { name: /^Mess Drawer/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sort and group' }));
    expect(screen.getByRole('menuitem', { name: 'Sort by title' })).toHaveClass('Mui-selected');
  });

  it('groups by priority, high first', async () => {
    await renderSeeded('/inbox');
    await screen.findByRole('button', { name: 'Open undated' });
    await userEvent.click(screen.getByRole('button', { name: 'Sort and group' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Group by priority' }));
    expect(groupHeadings()).toContain('No priority6');
  });
});

describe('task menu', () => {
  it('makes a task a subtask of another from the right-click menu', async () => {
    await renderSeeded('/inbox');
    const row = await screen.findByRole('button', { name: 'Open tomorrow' });
    fireEvent.contextMenu(row);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make subtask of...' }));
    const dialog = screen.getByRole('dialog', { name: 'Make "tomorrow" a subtask of' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Search tasks' }), 'undat');
    await userEvent.click(within(dialog).getByRole('button', { name: /^undated/ }));
    expect(screen.getByText('Moved under undated')).toBeInTheDocument();
    // tomorrow keeps its own date, so it stays in Tomorrow and names its parent.
    const moved = screen.getByRole('button', { name: 'Open tomorrow' });
    expect(within(moved).getByTestId('task-meta')).toHaveTextContent('undated');
  });

  it('moves a task to another list from the menu (also the long-press menu on touch)', async () => {
    await renderSeeded('/inbox');
    const row = await screen.findByRole('button', { name: 'Open tomorrow' });
    fireEvent.contextMenu(row);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to list...' }));
    const dialog = screen.getByRole('dialog', { name: 'Move "tomorrow" to' });
    // The list it is on is not offered.
    expect(within(dialog).queryByRole('button', { name: 'Mess Drawer' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Work' }));
    expect(screen.getByText('Moved to Work')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open tomorrow' })).toBeNull());
  });

  it('offers the same actions from the details panel', async () => {
    await renderSeeded('/inbox');
    await userEvent.click(await screen.findByRole('button', { name: 'Open next month' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Task actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make subtask of...' }));
    const dialog = screen.getByRole('dialog', { name: 'Make "next month" a subtask of' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Search tasks' }),
      'undated{Enter}',
    );
    await waitFor(() =>
      expect(within(details).getByRole('navigation', { name: 'Parent tasks' })).toHaveTextContent(
        'undated',
      ),
    );
  });
});

describe('list names on rows', () => {
  it('names the list on every row in mixed views, nested rows and loose subtasks too', async () => {
    const store = testStore();
    await renderApp('/all', store);
    const day = today();
    store.getState().apply((ctx, ws) => {
      const me = createList(ctx, ws, { name: 'Me', color: '#A7C7E7' });
      const parent = createTask(ctx, me.workspace, {
        title: 'Parent',
        listId: me.list.id,
        schedule: on(day),
      });
      const child = createTask(ctx, parent.workspace, {
        title: 'Child',
        listId: me.list.id,
        parentId: parent.task.id,
      });
      return createTask(ctx, child.workspace, {
        title: 'Later child',
        listId: me.list.id,
        parentId: parent.task.id,
        schedule: on(addDays(day, 3)),
      }).workspace;
    });
    const meta = async (title: string) =>
      within(await screen.findByRole('button', { name: `Open ${title}` })).getByTestId('task-meta');
    expect(await meta('Parent')).toHaveTextContent('Me');
    expect(await meta('Child')).toHaveTextContent('Me');
    // On its own day: names both its parent and its list.
    expect(await meta('Later child')).toHaveTextContent('ParentMe');
  });
});

describe('long lists', () => {
  // Drawing 230 rows in jsdom takes seconds, more under coverage: past the 5 s default.
  it('draws the first 200 rows and more on asking', { timeout: 30_000 }, async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    act(() =>
      store.getState().apply((ctx, ws) => {
        let next = ws;
        for (let i = 0; i < 230; i += 1) {
          next = createTask(ctx, next, {
            title: `Task ${i}`,
            listId: inboxList(next).id,
          }).workspace;
        }
        return next;
      }),
    );
    const rows = () => document.querySelectorAll('main [data-task-row]').length;
    await waitFor(() => expect(rows()).toBe(200), { timeout: 20_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Show 30 more' }));
    expect(rows()).toBe(230);
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });
});
