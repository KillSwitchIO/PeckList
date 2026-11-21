import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { createList, inboxList, visibleLists } from '../../core/lists.ts';
import {
  createSavedFilter,
  DUE_CHOICES,
  filterOf,
  setSavedFilterView,
  viewOf,
} from '../../core/savedFilters.ts';
import { setAssignee } from '../../core/sharing.ts';
import { createTag } from '../../core/tags.ts';
import { createTask, setTaskStatus } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('saved filters', () => {
  it('count their tasks in the sidebar and edit due date and closed tasks', async () => {
    const store = testStore();
    await renderApp('/today', store);
    const today = todayIn(localTimeZone(), Date.now());
    store.getState().apply((ctx, ws) => {
      const listId = inboxList(ws).id;
      const due = (days: number) => ({ at: addDays(today, days), allDay: true, timeZone: 'UTC' });
      let next = createTask(ctx, ws, { title: 'Pay rent', listId, due: due(-2) }).workspace;
      next = createTask(ctx, next, { title: 'Renew passport', listId, due: due(-1) }).workspace;
      next = createTask(ctx, next, { title: 'Plan trip', listId, due: due(30) }).workspace;
      const old = createTask(ctx, next, { title: 'Old bill', listId, due: due(-5) });
      next = setTaskStatus(ctx, old.workspace, old.task.id, 'done');
      return createSavedFilter(ctx, next, 'Late', DUE_CHOICES.overdue).workspace;
    });
    const nav = screen.getAllByRole('navigation')[0]!;
    const row = await within(nav).findByRole('button', { name: /Late/ });
    expect(row).toHaveTextContent('2');

    await userEvent.click(row);
    expect(await screen.findByRole('button', { name: 'Open Pay rent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Plan trip' })).toBeNull();
    expect(screen.getByText('Old bill')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit filter' }));
    const dialog = await screen.findByRole('dialog');
    const due = within(dialog).getByRole('group', { name: 'Due date' });
    expect(within(due).getByRole('button', { name: 'Overdue' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Show closed tasks' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByText('Old bill')).toBeNull());
    const saved = store.getState().workspace!.entities.savedFilters[0]!;
    expect(filterOf(saved)).toEqual({ due: { to: -1 }, closed: false });
  });

  it('narrows by date state and by who a task is assigned to', async () => {
    const store = testStore();
    await renderApp('/today', store);
    const today = todayIn(localTimeZone(), Date.now());
    store.getState().apply((ctx, ws) => {
      const listId = inboxList(ws).id;
      const due = (days: number) => ({
        at: addDays(today, days),
        allDay: true,
        timeZone: localTimeZone(),
      });
      let next = createTask(ctx, ws, { title: 'Late one', listId, due: due(-1) }).workspace;
      next = createTask(ctx, next, { title: 'Soon one', listId, due: due(1) }).workspace;
      const mine = createTask(ctx, next, { title: 'Mine', listId, due: due(1) });
      next = setAssignee(ctx, mine.workspace, mine.task.id, `user:${ctx.userId}`, true);
      return createSavedFilter(ctx, next, 'Watch', {}).workspace;
    });
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(await within(nav).findByRole('button', { name: /Watch/ }));
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit filter' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Due soon' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Late one' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Open Soon one' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit filter' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Me' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Soon one' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Open Mine' })).toBeInTheDocument();
    expect(filterOf(store.getState().workspace!.entities.savedFilters[0]!)).toEqual({
      states: ['dueSoon'],
      assignees: ['me'],
    });
  });

  it('picks all lists or tags at once, and lets them all go (Ben, 0.14.0)', async () => {
    const store = testStore();
    await renderApp('/today', store);
    store.getState().apply((ctx, ws) => {
      let next = createList(ctx, ws, { name: 'Work', color: '#A7C7E7' }).workspace;
      next = createTag(ctx, next, 'home', '#A8DCC0').workspace;
      next = createTag(ctx, next, 'errands', '#F0B072').workspace;
      return createSavedFilter(ctx, next, 'Mine', {}).workspace;
    });
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(await within(nav).findByRole('button', { name: /Mine/ }));
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit filter' }));
    const dialog = await screen.findByRole('dialog');
    const lists = within(dialog).getByRole('button', { name: 'Select all: Lists' });
    const noTags = within(dialog).getByRole('button', { name: 'Deselect all: Tags' });
    expect(noTags).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(lists);
    expect(lists).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Select all: Tags' }));
    expect(within(dialog).getByRole('button', { name: 'home' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Then all the tags let go again: an empty part narrows nothing, so it is left out.
    await userEvent.click(noTags);
    expect(within(dialog).getByRole('button', { name: 'errands' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const workspace = store.getState().workspace!;
    const all = visibleLists(workspace).map((list) => list.id);
    expect(filterOf(workspace.entities.savedFilters[0]!)).toEqual({ lists: all });
  });

  it('keep their grouping with the filter, so it syncs (PL-015)', async () => {
    const store = testStore();
    await store.getState().init();
    let filterId = '';
    store.getState().apply((ctx, ws) => {
      const listId = inboxList(ws).id;
      let next = createTask(ctx, ws, { title: 'Mop', listId, priority: 1 }).workspace;
      next = createTask(ctx, next, { title: 'Fix the gate', listId, priority: 3 }).workspace;
      const made = createSavedFilter(ctx, next, 'Chores', {});
      filterId = made.filter.id;
      return made.workspace;
    });
    await store.getState().flush();
    // A choice this browser kept before still shows, until the next pick moves it to the filter.
    localStorage.setItem(
      'pecklist.listGrouping',
      JSON.stringify({ [`filter:${filterId}`]: { group: 'none' } }),
    );
    await renderApp(`/filters/${filterId}`, store);
    await screen.findByRole('button', { name: 'Open Mop' });
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(await screen.findByRole('menuitem', { name: 'Group by none' })).toHaveClass(
      'Mui-selected',
    );

    await userEvent.click(screen.getByRole('menuitem', { name: 'Group by priority' }));
    const saved = () => store.getState().workspace!.entities.savedFilters[0]!;
    await waitFor(() => expect(viewOf(saved())).toEqual({ group: 'priority' }));
    expect(localStorage.getItem('pecklist.listGrouping')).toBe('{}');
    expect(await screen.findByRole('heading', { level: 2, name: /^High/ })).toBeInTheDocument();

    // Another device picks: this one follows.
    store
      .getState()
      .apply((ctx, ws) => setSavedFilterView(ctx, ws, filterId, { group: 'none', sort: 'title' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 2, name: /^High/ })).toBeNull(),
    );
    const titles = screen
      .getAllByRole('button', { name: /^Open / })
      .map((row) => row.getAttribute('aria-label'));
    expect(titles).toEqual(['Open Fix the gate', 'Open Mop']);
  });

  it("drop this browser's old grouping once another device stores one (PL-015)", async () => {
    const store = testStore();
    await store.getState().init();
    let filterId = '';
    store.getState().apply((ctx, ws) => {
      const next = createTask(ctx, ws, { title: 'Mop', listId: inboxList(ws).id }).workspace;
      const made = createSavedFilter(ctx, next, 'Chores', {});
      filterId = made.filter.id;
      return made.workspace;
    });
    await store.getState().flush();
    localStorage.setItem(
      'pecklist.listGrouping',
      JSON.stringify({ [`filter:${filterId}`]: { group: 'none' } }),
    );
    await renderApp(`/filters/${filterId}`, store);
    await screen.findByRole('button', { name: 'Open Mop' });
    // Another device picks, then restores the defaults: this one goes back to by date, not to
    // its own old choice.
    store.getState().apply((ctx, ws) => setSavedFilterView(ctx, ws, filterId, { group: 'tag' }));
    await waitFor(() => expect(localStorage.getItem('pecklist.listGrouping')).toBe('{}'));
    store.getState().apply((ctx, ws) => setSavedFilterView(ctx, ws, filterId, {}));
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(await screen.findByRole('menuitem', { name: 'Group by date' })).toHaveClass(
      'Mui-selected',
    );
  });
});
