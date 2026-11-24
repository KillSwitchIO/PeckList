import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addBlocker } from '../../core/blocking.ts';
import { putEntity } from '../../core/collections.ts';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { createList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { createTask } from '../../core/tasks.ts';
import type { Id, ListMember, Task, WorkspaceFile } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const mouse = { pointerType: 'mouse', pointerId: 1 };

/**
 * A Garden list on its timeline: Buy soil (today and tomorrow), Build beds (in three days) and
 * Plant (in five days). `overlap` starts Build beds today instead, before Buy soil ends.
 */
async function garden({ overlap = false } = {}) {
  const store = testStore();
  await store.getState().init();
  const today = todayIn(localTimeZone(), Date.now());
  const zone = localTimeZone();
  const ids: Record<string, Id> = {};
  let listId = '';
  store.getState().apply((ctx, ws) => {
    let next: WorkspaceFile = ws;
    const made = createList(ctx, next, { name: 'Garden', color: '#CFE3A3' });
    next = made.workspace;
    listId = made.list.id;
    const plan: [string, number, number | null][] = [
      ['Buy soil', 0, 1],
      ['Build beds', overlap ? 0 : 3, null],
      ['Plant', 5, null],
    ];
    for (const [title, start, end] of plan) {
      const task = createTask(ctx, next, {
        title,
        listId,
        schedule: {
          start: addDays(today, start),
          end: end === null ? null : addDays(today, end),
          allDay: true,
          timeZone: zone,
        },
      });
      ids[title] = task.task.id;
      next = task.workspace;
    }
    return next;
  });
  await store.getState().flush();
  localStorage.setItem('pecklist.listLayouts', JSON.stringify({ [listId]: 'timeline' }));
  await renderApp(`/lists/${listId}`, store);
  const chart = await screen.findByRole('grid', { name: 'Timeline' });
  const task = (title: string): Task =>
    store.getState().workspace!.entities.tasks.find((each) => each.id === ids[title])!;
  const bar = (title: string) =>
    chart.querySelector<HTMLElement>(`[data-timeline-bar="${ids[title]!}"]`)!;
  const handle = (title: string) =>
    chart.querySelector<HTMLElement>(`[data-timeline-link-handle="${ids[title]!}"]`)!;
  const arrows = () => [...chart.querySelectorAll<SVGPathElement>('[data-timeline-link]')];
  const link = (blocked: string, blocker: string) =>
    act(() =>
      store.getState().apply((ctx, ws) => addBlocker(ctx, ws, ids[blocked]!, ids[blocker]!)),
    );
  /** Drag from a bar's handle and let go over `onto` (jsdom has no layout: say what is under it). */
  const drawLink = (from: string, onto: string) => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(bar(onto));
    fireEvent.pointerDown(handle(from), { clientX: 100, clientY: 60, button: 0, ...mouse });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 94, ...mouse });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 94, ...mouse });
  };
  return { store, ids, task, bar, handle, arrows, link, drawLink, chart };
}

describe('blocked-by links on the timeline (PL-055)', () => {
  it('draws an arrow from the blocker’s end to the waiting bar’s start, red when it starts too soon', async () => {
    const { arrows, link, ids } = await garden();
    expect(arrows()).toEqual([]);
    link('Build beds', 'Buy soil');
    await waitFor(() => expect(arrows()).toHaveLength(1));
    const [arrow] = arrows();
    expect(arrow!.dataset.timelineLink).toBe(`${ids['Buy soil']!} ${ids['Build beds']!}`);
    expect(arrow!.dataset.late).toBeUndefined();
    expect(arrow!.getAttribute('d')).toMatch(/^M \d+ \d+ H \d+ V \d+ H \d+$/);
  });

  it('turns the arrow red when the waiting task starts before its blocker ends', async () => {
    const { arrows, link } = await garden({ overlap: true });
    link('Build beds', 'Buy soil');
    await waitFor(() => expect(arrows()).toHaveLength(1));
    expect(arrows()[0]!.dataset.late).toBe('true');
    expect(arrows()[0]!.getAttribute('stroke')).not.toBe(arrows()[0]!.getAttribute('fill'));
  });

  it('dragging from a bar’s handle onto another bar links them, with Undo', async () => {
    const { drawLink, task, ids, arrows } = await garden();
    drawLink('Buy soil', 'Build beds');
    await waitFor(() => expect(task('Build beds').blockedBy[ids['Buy soil']!]?.in).toBe(true));
    expect(screen.getByText('Linked to wait on Buy soil')).toBeInTheDocument();
    expect(arrows()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(arrows()).toEqual([]));
  });

  it('refuses a drop that would make a loop, and one on the bar itself', async () => {
    const { drawLink, link, store, ids, task } = await garden();
    link('Build beds', 'Buy soil');
    link('Plant', 'Build beds');
    const before = store.getState().workspace;
    // Buy soil waiting on Plant: Plant already waits on it down the chain.
    drawLink('Plant', 'Buy soil');
    expect(store.getState().workspace).toBe(before);
    expect(task('Buy soil').blockedBy[ids['Plant']!]).toBeUndefined();
    drawLink('Plant', 'Plant');
    expect(store.getState().workspace).toBe(before);
  });

  it('Escape mid-drag drops the link: letting go then links nothing', async () => {
    const { handle, bar, store, chart } = await garden();
    const before = store.getState().workspace;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(bar('Plant'));
    fireEvent.pointerDown(handle('Buy soil'), { clientX: 100, clientY: 60, button: 0, ...mouse });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 94, ...mouse });
    expect(chart.querySelector('[data-timeline-linking]')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(chart.querySelector('[data-timeline-linking]')).toBeNull());
    fireEvent.pointerUp(window, { clientX: 220, clientY: 94, ...mouse });
    expect(store.getState().workspace).toBe(before);
  });

  it('a bar being moved when the timeline goes away moves nothing on a later let-go', async () => {
    const { bar, store } = await garden();
    const before = store.getState().workspace;
    fireEvent.pointerDown(bar('Buy soil'), { clientX: 100, clientY: 60, button: 0, ...mouse });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 60, ...mouse });
    // Off to another page mid-move (a click, so no pointer events of its own end the move).
    fireEvent.click(within(screen.getAllByRole('navigation')[0]!).getByText('Today'));
    await waitFor(() => expect(screen.queryByRole('grid', { name: 'Timeline' })).toBeNull());
    fireEvent.pointerUp(window, { clientX: 400, clientY: 60, ...mouse });
    expect(store.getState().workspace).toBe(before);
  });

  it('a finger gets no handle: a touch on it does nothing', async () => {
    const { handle, bar, store } = await garden();
    const before = store.getState().workspace;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(bar('Plant'));
    const touch = { pointerType: 'touch', pointerId: 4 };
    fireEvent.pointerDown(handle('Buy soil'), { clientX: 100, clientY: 60, button: 0, ...touch });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 94, ...touch });
    expect(store.getState().workspace).toBe(before);
    expect(within(bar('Buy soil')).getByTitle('Drag to a task that waits on this one')).toBe(
      handle('Buy soil'),
    );
  });
});

describe('reaching the link handle with a mouse (rc.3: it hid before it could be reached)', () => {
  afterEach(() => vi.useRealTimers());

  it('shows on a hovered bar and stays while the pointer goes past the bar’s end onto it', async () => {
    const { bar, handle } = await garden();
    expect(handle('Buy soil').dataset.shown).toBeUndefined();
    vi.useFakeTimers();
    fireEvent.pointerEnter(bar('Buy soil'), mouse);
    expect(handle('Buy soil').dataset.shown).toBe('true');
    // Out past the bar's end, then on to the handle: it is still there to press.
    fireEvent.pointerLeave(bar('Buy soil'), mouse);
    act(() => vi.advanceTimersByTime(150));
    expect(handle('Buy soil').dataset.shown).toBe('true');
    fireEvent.pointerEnter(handle('Buy soil'), mouse);
    act(() => vi.advanceTimersByTime(2000));
    expect(handle('Buy soil').dataset.shown).toBe('true');
  });

  it('goes a moment after the pointer leaves for somewhere else, and moves to the next bar hovered', async () => {
    const { bar, handle } = await garden();
    vi.useFakeTimers();
    fireEvent.pointerEnter(bar('Buy soil'), mouse);
    fireEvent.pointerLeave(bar('Buy soil'), mouse);
    act(() => vi.advanceTimersByTime(1000));
    expect(handle('Buy soil').dataset.shown).toBeUndefined();
    fireEvent.pointerEnter(bar('Buy soil'), mouse);
    fireEvent.pointerLeave(bar('Buy soil'), mouse);
    fireEvent.pointerEnter(bar('Plant'), mouse);
    expect(handle('Plant').dataset.shown).toBe('true');
    act(() => vi.advanceTimersByTime(1000));
    expect(handle('Buy soil').dataset.shown).toBeUndefined();
    expect(handle('Plant').dataset.shown).toBe('true');
  });

  it('a finger passing over a bar shows no handle', async () => {
    const { bar, handle } = await garden();
    fireEvent.pointerEnter(bar('Buy soil'), { pointerType: 'touch', pointerId: 4 });
    expect(handle('Buy soil').dataset.shown).toBeUndefined();
  });
});

describe('the task menu on the timeline (rc.3: a hold on the phone did nothing)', () => {
  afterEach(() => vi.useRealTimers());
  const finger = { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 60 };

  it('a held finger let go without moving opens the menu, and Blocked by... links from there', async () => {
    mockViewport('phone');
    const { bar, store, ids, task } = await garden();
    const before = store.getState().workspace;
    vi.useFakeTimers();
    fireEvent.pointerDown(bar('Build beds'), { button: 0, ...finger });
    act(() => vi.advanceTimersByTime(500));
    // A phone sends a context menu event on a long press: not the menu yet, the lift opens it.
    fireEvent.contextMenu(bar('Build beds'), { clientX: 100, clientY: 60 });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerUp(window, finger);
    fireEvent.touchEnd(document, { touches: [] });
    // The menu opens under the finger: the click that lifting it sends, on the first item, neither
    // opens the task nor closes the menu.
    fireEvent.click(within(screen.getByRole('menu')).getByText('Open'));
    vi.useRealTimers();
    const menu = await screen.findByRole('menu');
    expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull();
    expect(store.getState().workspace).toBe(before);
    expect(within(menu).getByText('Open')).toBeInTheDocument();
    await userEvent.click(within(menu).getByText('Blocked by...'));
    const picker = await screen.findByRole('dialog');
    await userEvent.click(await within(picker).findByText('Buy soil'));
    await waitFor(() => expect(task('Build beds').blockedBy[ids['Buy soil']!]?.in).toBe(true));
  });

  it('opens the menu when the phone cancels the held finger’s pointer, from the touch’s own end', async () => {
    mockViewport('phone');
    const { bar } = await garden();
    vi.useFakeTimers();
    fireEvent.pointerDown(bar('Plant'), { button: 0, ...finger });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerCancel(window, finger);
    fireEvent.touchEnd(document, { touches: [] });
    vi.useRealTimers();
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('a held bar moved, a quick tap, or a finger that scrolls opens no menu', async () => {
    mockViewport('phone');
    const { bar, task } = await garden();
    const start = task('Plant').schedule!.start;
    vi.useFakeTimers();
    // Held, then moved two days: the bar moves, no menu.
    fireEvent.pointerDown(bar('Plant'), { button: 0, ...finger });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(window, { ...finger, clientX: 100 + 2 * 40 });
    fireEvent.pointerUp(window, { ...finger, clientX: 100 + 2 * 40 });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(task('Plant').schedule!.start).not.toBe(start);
    // Moved before the hold: a scroll.
    fireEvent.pointerDown(bar('Buy soil'), { button: 0, ...finger });
    fireEvent.pointerMove(window, { ...finger, clientX: 160 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(window, { ...finger, clientX: 160 });
    expect(screen.queryByRole('menu')).toBeNull();
    // A quick tap opens the task.
    fireEvent.pointerDown(bar('Buy soil'), { button: 0, ...finger });
    fireEvent.pointerUp(window, finger);
    vi.useRealTimers();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeInTheDocument();
  });

  it('a right click on a bar opens the menu', async () => {
    const { bar } = await garden();
    fireEvent.pointerDown(bar('Plant'), { button: 2, ...mouse });
    fireEvent.contextMenu(bar('Plant'), { clientX: 100, clientY: 60 });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});

describe('the timeline of a list I can only view', () => {
  afterEach(() => vi.useRealTimers());

  it('a hold opens the menu (Open only) and moves nothing', async () => {
    mockViewport('phone');
    const SAM = '01JBSAM0000000000000000002';
    const store = testStore();
    await store.getState().init();
    const today = todayIn(localTimeZone(), Date.now());
    let listId = '';
    store.getState().apply((ctx, ws) => {
      const created = createList(ctx, ws, { name: 'Garden', color: '#CFE3A3' });
      const list = { ...created.list, createdBy: SAM, visibility: 'shared' as const };
      listId = list.id;
      const task = createTask(ctx, putEntity(created.workspace, 'lists', list), {
        title: 'Fix fence',
        listId,
        schedule: { start: today, end: null, allDay: true, timeZone: localTimeZone() },
      });
      const member = createEntity<ListMember>(ctx, {
        listId,
        principal: `user:${ctx.userId}`,
        role: 'viewer',
      });
      return putEntity(task.workspace, 'listMembers', member);
    });
    await store.getState().flush();
    localStorage.setItem('pecklist.listLayouts', JSON.stringify({ [listId]: 'timeline' }));
    await renderApp(`/lists/${listId}`, store);
    const chart = await screen.findByRole('grid', { name: 'Timeline' });
    const before = store.getState().workspace;
    const bar = chart.querySelector<HTMLElement>('[data-timeline-bar]')!;
    const finger = { pointerType: 'touch', pointerId: 8, clientX: 100, clientY: 60 };
    vi.useFakeTimers();
    fireEvent.pointerDown(bar, { button: 0, ...finger });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(window, finger);
    vi.useRealTimers();
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Open']);
    expect(store.getState().workspace).toBe(before);
  });
});
