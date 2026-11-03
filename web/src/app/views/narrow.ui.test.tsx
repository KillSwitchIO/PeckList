import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { createTag } from '../../core/tags.ts';
import { createTask } from '../../core/tasks.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function seeded(path: string) {
  const store = testStore();
  await store.getState().init();
  const today = todayIn(localTimeZone(), Date.now());
  store.getState().apply((ctx, ws) => {
    let next: WorkspaceFile = ws;
    const work = createList(ctx, next, { name: 'Work', color: '#A7C7E7' });
    next = work.workspace;
    const urgent = createTag(ctx, next, 'urgent', '#E8837E');
    next = urgent.workspace;
    const on = { start: today, end: null, allDay: true, timeZone: localTimeZone() };
    for (const [title, listId, tags] of [
      ['Ship report', work.list.id, [urgent.tag.id]],
      ['Team lunch', work.list.id, []],
      ['Water plants', inboxList(next).id, [urgent.tag.id]],
    ] as const) {
      next = createTask(ctx, next, { title, listId, tags: [...tags], schedule: on }).workspace;
    }
    return next;
  });
  await store.getState().flush();
  await renderApp(path, store);
}

const shown = (title: string) => screen.queryByRole('button', { name: `Open ${title}` });

describe('filtering Today, Upcoming and the calendar', () => {
  it('shows only the lists and tags picked, keeps it, and clears it', async () => {
    await seeded('/today');
    expect(shown('Water plants')).toBeInTheDocument();
    const pick = async (kind: string, name: string) => {
      await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
      const panel = await screen.findByRole('dialog', { name: 'Show only' });
      await userEvent.click(
        within(within(panel).getByRole('list', { name: kind })).getByRole('menuitemcheckbox', {
          name,
        }),
      );
      await userEvent.keyboard('{Escape}');
    };
    await pick('Lists', 'Work');
    expect(shown('Water plants')).toBeNull();
    expect(shown('Team lunch')).toBeInTheDocument();
    // Both kinds must hold: in Work and tagged urgent.
    await pick('Tags', 'urgent');
    expect(shown('Team lunch')).toBeNull();
    expect(shown('Ship report')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter (on)' })).toBeInTheDocument();

    // Upcoming has its own.
    const nav = () => screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav()).getByRole('button', { name: /^Upcoming/ }));
    expect(await screen.findByRole('button', { name: 'Filter' })).toBeInTheDocument();
    expect(shown('Water plants')).toBeInTheDocument();

    await userEvent.click(within(nav()).getByRole('button', { name: /^Today/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Filter (on)' }));
    const panel = await screen.findByRole('dialog', { name: 'Show only' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Clear' }));
    // Clear is disabled now, so the panel takes the key.
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(shown('Water plants')).toBeInTheDocument();
    expect(localStorage.getItem('pecklist.narrow.today')).toBeNull();
  });
});
