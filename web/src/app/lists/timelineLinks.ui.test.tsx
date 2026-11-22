import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addBlocker } from '../../core/blocking.ts';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { createList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import type { Id, Task, WorkspaceFile } from '../../core/types.ts';
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
