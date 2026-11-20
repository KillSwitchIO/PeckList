import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { createTag } from '../../core/tags.ts';
import { createTask } from '../../core/tasks.ts';
import type { Schedule } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

const today = () => todayIn(localTimeZone(), Date.now());
const on = (date: string): Schedule => ({ start: date, end: null, allDay: true, timeZone: 'UTC' });

/** Today with an overdue task, one in a list with a tag, and one in the Mess Drawer. */
async function renderToday() {
  const store = testStore();
  await renderApp('/today', store);
  const day = today();
  store.getState().apply((ctx, ws) => {
    const inbox = inboxList(ws).id;
    const work = createList(ctx, ws, { name: 'Work', color: '#A7C7E7' });
    const tag = createTag(ctx, work.workspace, 'home', '#A8DCC0');
    let next = tag.workspace;
    next = createTask(ctx, next, {
      title: 'overdue thing',
      listId: inbox,
      schedule: on(addDays(day, -2)),
    }).workspace;
    next = createTask(ctx, next, {
      title: 'work thing',
      listId: work.list.id,
      schedule: on(day),
      tags: [tag.tag.id],
    }).workspace;
    next = createTask(ctx, next, {
      title: 'today thing',
      listId: inbox,
      schedule: on(day),
    }).workspace;
    return next;
  });
  await screen.findByRole('button', { name: 'Open work thing' });
  return store;
}

const row = (title: string) =>
  screen.getByRole('button', { name: `Open ${title}` }).closest('[data-task-row]')
    ?.parentElement as HTMLElement;

async function pick(name: 'Comfortable' | 'Compact') {
  fireEvent.click(screen.getByRole('button', { name: 'View options' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

describe('Today rows, compact (F1)', () => {
  it('Row size in the view options makes the rows compact, keeps the order, syncs, and goes back', async () => {
    mockViewport('desktop');
    const store = await renderToday();
    // Roomy by default, and the menu says so.
    expect(row('today thing')).not.toHaveAttribute('data-compact');
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Row size')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Comfortable' })).toHaveClass('Mui-selected');
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await pick('Compact');
    for (const title of ['overdue thing', 'work thing', 'today thing']) {
      expect(row(title)).toHaveAttribute('data-compact');
    }
    // The setting syncs with the rest of the person's settings.
    expect(store.getState().workspace?.entities.settings[0]?.compactViews).toEqual(['view:today']);
    // Same order: overdue first, then today's.
    const titles = screen
      .getAllByRole('button', { name: /^Open (overdue|work|today) thing$/ })
      .map((each) => each.getAttribute('aria-label'));
    expect(titles[0]).toBe('Open overdue thing');
    // A wide compact row keeps its tag and list.
    expect(within(row('work thing')).getByText('Work')).toBeInTheDocument();
    expect(within(row('work thing')).getByText('home')).toBeInTheDocument();

    await pick('Comfortable');
    expect(row('today thing')).not.toHaveAttribute('data-compact');
    expect(store.getState().workspace?.entities.settings[0]?.compactViews).toEqual([]);
  });

  it('on a phone a compact row is one line: no tag or list under the title, the date stays', async () => {
    mockViewport('phone');
    await renderToday();
    // Two lines on a phone: the details sit under the title.
    expect(within(row('work thing')).getByText('Work')).toBeInTheDocument();
    await pick('Compact');
    const work = row('work thing');
    expect(work).toHaveAttribute('data-compact');
    expect(within(work).queryByText('Work')).toBeNull();
    expect(within(work).queryByText('home')).toBeNull();
    // The date stays on the line, on the right.
    expect(
      within(row('overdue thing')).getByRole('button', { name: /^[^:]+: .+/, hidden: false }),
    ).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('other views offer no Row size', async () => {
    mockViewport('desktop');
    const store = testStore();
    await renderApp('/upcoming', store);
    fireEvent.click(await screen.findByRole('button', { name: 'View options' }));
    await screen.findByRole('menu');
    expect(screen.queryByText('Row size')).toBeNull();
  });
});
