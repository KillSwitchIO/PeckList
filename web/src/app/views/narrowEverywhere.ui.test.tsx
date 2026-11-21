// The funnel on every task view (Ben, 0.14.0 rc.1: "these screens are missing filters: due
// dates, search, assigned to me, shared with me, all, mess drawer"). Each view keeps its own
// narrowing, as Today and Upcoming do; the Mess Drawer, one list already, offers no lists.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { putEntity } from '../../core/collections.ts';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { createEntity, updateEntity } from '../../core/ops.ts';
import { setAssignee } from '../../core/sharing.ts';
import { createTag } from '../../core/tags.ts';
import { createTask } from '../../core/tasks.ts';
import type { ListMember, WorkspaceFile } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

const SAM = '01JBSAM0000000000000000002';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
  // A fixed local noon: "today" and the render must fall on the same day.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 18, 12, 0) });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Work and the Mess Drawer, one tag: every task due today and assigned to me, so each view shows
 * all three. With `shared`, Work is Sam's list shared with me, and a second of his, Garden, holds
 * the Mess Drawer's task instead.
 */
async function seeded(path: string, { shared = false } = {}): Promise<{ work: string }> {
  const store = testStore();
  await store.getState().init();
  const today = todayIn(localTimeZone(), Date.now());
  let workId = '';
  store.getState().apply((ctx, ws) => {
    let next: WorkspaceFile = ws;
    const sams = (name: string) => {
      const made = createList(ctx, next, { name, color: '#A7C7E7' });
      const list = shared
        ? updateEntity(ctx, made.list, { ownerId: SAM, visibility: 'shared' })
        : made.list;
      next = putEntity(made.workspace, 'lists', list);
      if (shared) {
        const member = createEntity<ListMember>(ctx, {
          listId: list.id,
          principal: `user:${ctx.userId}`,
          role: 'editor',
        });
        next = putEntity(next, 'listMembers', member);
      }
      return list.id;
    };
    const work = sams('Work');
    workId = work;
    const other = shared ? sams('Garden') : inboxList(next).id;
    const urgent = createTag(ctx, next, 'urgent', '#E8837E');
    next = urgent.workspace;
    const due = { at: today, allDay: true, timeZone: localTimeZone() };
    for (const [title, listId, tags] of [
      ['Ship report', work, [urgent.tag.id]],
      ['Team lunch', work, []],
      ['Water plants', other, [urgent.tag.id]],
    ] as const) {
      const made = createTask(ctx, next, { title, listId, tags: [...tags], due });
      next = setAssignee(ctx, made.workspace, made.task.id, `user:${ctx.userId}`, true);
    }
    return next;
  });
  await store.getState().flush();
  await renderApp(path.replace(':work', workId), store);
  return { work: workId };
}

const shown = (title: string) =>
  screen.queryByRole('button', { name: new RegExp(`^Open ${title}`) });

async function openFunnel() {
  await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  return screen.findByRole('dialog', { name: 'Show only' });
}

async function pick(kind: string, name: string) {
  const panel = await openFunnel();
  await userEvent.click(
    within(within(panel).getByRole('list', { name: kind })).getByRole('menuitemcheckbox', {
      name,
    }),
  );
  await userEvent.keyboard('{Escape}');
}

describe('the funnel on every task view', () => {
  it.each([
    ['Due dates', '/due', 'due'],
    ['All', '/all', 'all'],
    ['Assigned to me', '/assigned', 'assigned'],
    ['Search', '/search?q=e', 'search'],
  ])('%s: picking a list narrows it, and leaves Today as it was', async (_, path, key) => {
    await seeded(path);
    expect(await screen.findByRole('button', { name: /^Open Water plants/ })).toBeInTheDocument();
    await pick('Lists', 'Work');
    expect(shown('Water plants')).toBeNull();
    expect(shown('Ship report')).toBeInTheDocument();
    expect(shown('Team lunch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter (on)' })).toBeInTheDocument();

    // Its own narrowing: Today's (and every other view's) stays as it was.
    expect(localStorage.getItem(`pecklist.narrow.${key}`)).not.toBeNull();
    const others = Object.keys(localStorage).filter(
      (name) => name.startsWith('pecklist.narrow.') && name !== `pecklist.narrow.${key}`,
    );
    expect(others).toEqual([]);
  });

  it('Shared with me: picking one of the shared lists narrows it', async () => {
    await seeded('/shared', { shared: true });
    expect(await screen.findByRole('button', { name: /^Open Water plants/ })).toBeInTheDocument();
    await pick('Lists', 'Work');
    expect(shown('Water plants')).toBeNull();
    expect(shown('Ship report')).toBeInTheDocument();
  });

  it('the Mess Drawer: tags with Select all and Deselect all, and no lists to pick', async () => {
    await seeded('/inbox');
    expect(await screen.findByRole('button', { name: /^Open Water plants/ })).toBeInTheDocument();
    const panel = await openFunnel();
    expect(within(panel).queryByRole('list', { name: 'Lists' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Select all: Lists' })).toBeNull();
    expect(within(panel).getByText(/^Pick any tags and saved filters\./)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Deselect all: Tags' }));
    // Nothing to deselect yet: still everything.
    expect(
      screen.queryByRole('button', { name: /^Open Water plants/, hidden: true }),
    ).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Select all: Tags' }));
    await userEvent.keyboard('{Escape}');
    expect(shown('Water plants')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter (on)' })).toBeInTheDocument();
  });

  it('the Mess Drawer: a tag hides its untagged tasks', async () => {
    const store = testStore();
    await store.getState().init();
    store.getState().apply((ctx, ws) => {
      let next: WorkspaceFile = ws;
      const urgent = createTag(ctx, next, 'urgent', '#E8837E');
      next = urgent.workspace;
      const inbox = inboxList(next).id;
      next = createTask(ctx, next, {
        title: 'Call mom',
        listId: inbox,
        tags: [urgent.tag.id],
      }).workspace;
      next = createTask(ctx, next, { title: 'Buy milk', listId: inbox }).workspace;
      return next;
    });
    await store.getState().flush();
    await renderApp('/inbox', store);
    expect(await screen.findByRole('button', { name: /^Open Buy milk/ })).toBeInTheDocument();
    await pick('Tags', 'urgent');
    expect(shown('Buy milk')).toBeNull();
    expect(shown('Call mom')).toBeInTheDocument();
  });

  it('another list has no funnel of its own', async () => {
    await seeded('/lists/:work');
    expect(await screen.findByRole('button', { name: /^Open Team lunch/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull();
  });
});
