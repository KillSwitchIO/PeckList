import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { createList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('a list as a timeline', () => {
  it('switches from the view menu, draws dated tasks as bars, and remembers it for that list', async () => {
    const store = testStore();
    await store.getState().init();
    const today = todayIn(localTimeZone(), Date.now());
    let listId = '';
    store.getState().apply((ctx, ws) => {
      let next: WorkspaceFile = ws;
      const made = createList(ctx, next, { name: 'Garden', color: '#CFE3A3' });
      next = made.workspace;
      listId = made.list.id;
      next = createTask(ctx, next, {
        title: 'Build beds',
        listId,
        schedule: { start: today, end: null, allDay: true, timeZone: localTimeZone() },
      }).workspace;
      next = createTask(ctx, next, { title: 'Pick seeds', listId }).workspace;
      return next;
    });
    await store.getState().flush();
    await renderApp(`/lists/${listId}`, store);

    await userEvent.click(await screen.findByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Timeline' }));
    const chart = await screen.findByRole('grid', { name: 'Timeline' });
    expect(within(chart).getByRole('button', { name: 'Open Build beds' })).toBeInTheDocument();
    // Undated tasks wait under it.
    expect(screen.getByRole('heading', { name: /No date/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Pick seeds' })).toBeInTheDocument();
    // The rows choice.
    await userEvent.click(screen.getByRole('button', { name: 'Fit together' }));
    expect(JSON.parse(localStorage.getItem('pecklist.timeline')!)).toMatchObject({ fit: true });
    expect(JSON.parse(localStorage.getItem('pecklist.listLayouts')!)).toEqual({
      [listId]: 'timeline',
    });

    // Back to List.
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'List' }));
    expect(screen.queryByRole('grid', { name: 'Timeline' })).toBeNull();
    expect(localStorage.getItem('pecklist.listLayouts')).toBe('{}');
  });
});
