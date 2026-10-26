import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../../core/dates.ts';
import { createList, inboxList } from '../../../core/lists.ts';
import { createTask } from '../../../core/tasks.ts';
import type { WorkspaceFile } from '../../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../../test/renderApp.tsx';

const ROW = 40;
const TOP = 100;

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
  // jsdom has no layout: rows stack 40 px apart from y = 100, in document order, and each zone
  // spans its own rows.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rows = [...document.querySelectorAll('[data-drag-row]')];
    const box = (top: number, height: number) =>
      ({
        top,
        bottom: top + height,
        left: 240,
        right: 840,
        height,
        width: 600,
        x: 240,
        y: top,
      }) as DOMRect;
    if (this.hasAttribute('data-drag-row')) return box(TOP + rows.indexOf(this) * ROW, ROW);
    if (this.hasAttribute('data-drag-zone')) {
      const own = [...this.querySelectorAll('[data-drag-row]')].map((row) => rows.indexOf(row));
      return own.length ? box(TOP + Math.min(...own) * ROW, own.length * ROW) : box(0, 0);
    }
    return box(0, 0);
  });
});
afterEach(() => vi.restoreAllMocks());

/** Press on a row's title and move the pointer to another row's middle, then let go. */
function dragOnto(title: string, onto: string, offset = 5, mark = 'drop-line') {
  const rows = [...document.querySelectorAll('[data-drag-row]')];
  const y = (name: string) =>
    TOP +
    rows.indexOf(screen.getByRole('button', { name: `Open ${name}` }).closest('[data-drag-row]')!) *
      ROW +
    ROW / 2;
  const from = screen.getByRole('button', { name: `Open ${title}` });
  fireEvent.pointerDown(from, { button: 0, clientX: 300, clientY: y(title), pointerType: 'mouse' });
  fireEvent.pointerMove(window, { clientX: 300, clientY: y(title) + 10 });
  fireEvent.pointerMove(window, { clientX: 300, clientY: y(onto) + offset });
  expect(screen.getByTestId(mark)).toBeInTheDocument();
  expect(screen.getByTestId('drag-card')).toHaveTextContent(title);
  fireEvent.pointerUp(window);
}

describe('dragging tasks between groups', () => {
  it('in Today, an overdue task dragged into Today starts today', async () => {
    const store = testStore();
    await store.getState().init();
    const today = todayIn(localTimeZone(), Date.now());
    const on = (date: string) => ({
      start: date,
      end: null,
      allDay: true,
      timeZone: localTimeZone(),
    });
    store.getState().apply((ctx, ws) => {
      let next: WorkspaceFile = ws;
      for (const [title, date] of [
        ['Old bill', addDays(today, -2)],
        ['Walk dog', today],
      ] as const) {
        next = createTask(ctx, next, {
          title,
          listId: inboxList(next).id,
          schedule: on(date),
        }).workspace;
      }
      return next;
    });
    await store.getState().flush();
    await renderApp('/today', store);
    await screen.findByRole('button', { name: 'Open Old bill' });
    // Into another group: the whole group lights up.
    dragOnto('Old bill', 'Walk dog', 5, 'drop-group');
    const start = () =>
      store.getState().workspace!.entities.tasks.find((task) => task.title === 'Old bill')!.schedule
        ?.start;
    await waitFor(() => expect(start()).toBe(today));
  });

  // R-FB-75: a task moved within its own day used to snap back.
  it("in Today, a task dragged within today's group stays where it is put", async () => {
    const store = testStore();
    await store.getState().init();
    const today = todayIn(localTimeZone(), Date.now());
    store.getState().apply((ctx, ws) => {
      let next: WorkspaceFile = ws;
      for (const title of ['Walk dog', 'Water plants', 'Call mom']) {
        next = createTask(ctx, next, {
          title,
          listId: inboxList(next).id,
          schedule: { start: today, end: null, allDay: true, timeZone: localTimeZone() },
        }).workspace;
      }
      return next;
    });
    await store.getState().flush();
    await renderApp('/today', store);
    await screen.findByRole('button', { name: 'Open Call mom' });
    const titles = () =>
      [...document.querySelectorAll<HTMLElement>('[data-drag-row]')].map((row) =>
        row.querySelector('[aria-label^="Open "]')!.getAttribute('aria-label')!.slice(5),
      );
    expect(titles()).toEqual(['Walk dog', 'Water plants', 'Call mom']);
    // Above the first row: a line, not the whole group.
    dragOnto('Call mom', 'Walk dog', -16);
    await waitFor(() => expect(titles()).toEqual(['Call mom', 'Walk dog', 'Water plants']));
    // And it stays so when the page is drawn again.
    await store.getState().flush();
    expect(titles()).toEqual(['Call mom', 'Walk dog', 'Water plants']);
  });

  it('in a list sorted by title, a drag puts it in place and switches to the own order', async () => {
    const store = testStore();
    await store.getState().init();
    let listId = '';
    store.getState().apply((ctx, ws) => {
      const made = createList(ctx, ws, { name: 'Chores', color: '#CFE3A3' });
      listId = made.list.id;
      let next = made.workspace;
      for (const title of ['Wash', 'Dry', 'Fold'])
        next = createTask(ctx, next, { title, listId }).workspace;
      return next;
    });
    await store.getState().flush();
    localStorage.setItem(
      'punchlist.listGrouping',
      JSON.stringify({ [listId]: { group: 'none', sort: 'title' } }),
    );
    await renderApp(`/lists/${listId}`, store);
    await screen.findByRole('button', { name: 'Open Fold' });
    const titles = () =>
      [...document.querySelectorAll<HTMLElement>('[data-drag-row]')].map((row) =>
        row.querySelector('[aria-label^="Open "]')!.getAttribute('aria-label')!.slice(5),
      );
    const sorted = titles();
    // Into the slot above the first row (its top edge; its middle would nest it).
    dragOnto(sorted[2]!, sorted[0]!, -16);
    await waitFor(() => expect(titles()[0]).toBe(sorted[2]));
    expect(JSON.parse(localStorage.getItem('punchlist.listGrouping')!)[listId]).toMatchObject({
      sort: 'manual',
    });
  });

  it('within Overdue (which takes nothing) shows no landing place and changes nothing', async () => {
    const store = testStore();
    await store.getState().init();
    const today = todayIn(localTimeZone(), Date.now());
    const on = (date: string) => ({
      start: date,
      end: null,
      allDay: true,
      timeZone: localTimeZone(),
    });
    store.getState().apply((ctx, ws) => {
      let next: WorkspaceFile = ws;
      for (const [title, date] of [
        ['Old bill', addDays(today, -2)],
        ['Old call', addDays(today, -3)],
        ['Walk dog', today],
      ] as const) {
        next = createTask(ctx, next, {
          title,
          listId: inboxList(next).id,
          schedule: on(date),
        }).workspace;
      }
      return next;
    });
    await store.getState().flush();
    await renderApp('/today', store);
    await screen.findByRole('button', { name: 'Open Old bill' });
    const before = JSON.stringify(
      store.getState().workspace!.entities.tasks.map((task) => task.schedule),
    );
    const rows = [...document.querySelectorAll('[data-drag-row]')];
    const y = (name: string) =>
      TOP +
      rows.indexOf(
        screen.getByRole('button', { name: `Open ${name}` }).closest('[data-drag-row]')!,
      ) *
        ROW +
      ROW / 2;
    const from = screen.getByRole('button', { name: 'Open Old call' });
    fireEvent.pointerDown(from, {
      button: 0,
      clientX: 300,
      clientY: y('Old call'),
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(window, { clientX: 300, clientY: y('Old call') - 10 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: y('Old bill') - 5 });
    expect(screen.queryByTestId('drop-line')).toBeNull();
    expect(screen.queryByTestId('drop-group')).toBeNull();
    fireEvent.pointerUp(window);
    expect(
      JSON.stringify(store.getState().workspace!.entities.tasks.map((task) => task.schedule)),
    ).toBe(before);
  });

  it('goes on with touch events when a phone cancels the held finger (Android)', async () => {
    const store = testStore();
    await store.getState().init();
    const today = todayIn(localTimeZone(), Date.now());
    const on = (date: string) => ({
      start: date,
      end: null,
      allDay: true,
      timeZone: localTimeZone(),
    });
    store.getState().apply((ctx, ws) => {
      let next: WorkspaceFile = ws;
      for (const [title, date] of [
        ['Old bill', addDays(today, -2)],
        ['Walk dog', today],
      ] as const) {
        next = createTask(ctx, next, {
          title,
          listId: inboxList(next).id,
          schedule: on(date),
        }).workspace;
      }
      return next;
    });
    await store.getState().flush();
    await renderApp('/today', store);
    const from = await screen.findByRole('button', { name: 'Open Old bill' });
    const rows = [...document.querySelectorAll('[data-drag-row]')];
    const y = (name: string) =>
      TOP +
      rows.indexOf(
        screen.getByRole('button', { name: `Open ${name}` }).closest('[data-drag-row]')!,
      ) *
        ROW +
      ROW / 2;
    vi.useFakeTimers();
    fireEvent.pointerDown(from, {
      button: 0,
      clientX: 300,
      clientY: y('Old bill'),
      pointerType: 'touch',
      pointerId: 5,
    });
    act(() => vi.advanceTimersByTime(600));
    // The browser takes the finger's pointer away; touch events go on.
    fireEvent.pointerCancel(window, { pointerType: 'touch', pointerId: 5 });
    fireEvent.touchMove(document, { touches: [{ clientX: 300, clientY: y('Old bill') + 12 }] });
    fireEvent.touchMove(document, { touches: [{ clientX: 300, clientY: y('Walk dog') + 5 }] });
    expect(screen.getByTestId('drag-card')).toHaveTextContent('Old bill');
    fireEvent.touchEnd(document, { touches: [] });
    vi.useRealTimers();
    const start = () =>
      store.getState().workspace!.entities.tasks.find((task) => task.title === 'Old bill')!.schedule
        ?.start;
    await waitFor(() => expect(start()).toBe(today));
  });
});
