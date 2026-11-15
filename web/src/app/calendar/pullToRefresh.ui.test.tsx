import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

// Pull to refresh is on in the Android app and installed apps: synced, and shown standalone.
const syncNow = vi.fn(() => Promise.resolve());
vi.mock('../sync/syncContext.ts', async (original) => {
  const actual = await original<typeof import('../sync/syncContext.ts')>();
  return {
    ...actual,
    useSyncState: <T,>(selector: Parameters<typeof actual.useSyncState<T>>[0]) =>
      actual.useSyncState((state) => selector({ ...state, phase: 'ready', syncNow })),
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  syncNow.mockClear();
  mockViewport('phone');
  const viewport = window.matchMedia;
  vi.stubGlobal('matchMedia', (query: string) => ({
    ...viewport(query),
    matches: query.includes('display-mode: standalone') || viewport(query).matches,
  }));
});

const PULL = { name: 'Pull down to sync' };
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** One finger as a phone sends it: a pointer event, then the touch event, at each step. */
function finger(target: Element, x: number, y: number) {
  const pointer = { pointerType: 'touch', pointerId: 3, isPrimary: true };
  const at = (cx: number, cy: number) => ({ clientX: cx, clientY: cy, pageX: cx, pageY: cy });
  let last = at(x, y);
  fireEvent.pointerDown(target, { ...pointer, button: 0, ...last });
  fireEvent.touchStart(target, { touches: [last] });
  return {
    move(cx: number, cy: number) {
      last = at(cx, cy);
      fireEvent.pointerMove(target, { ...pointer, ...last });
      fireEvent.touchMove(target, { touches: [last] });
    },
    up() {
      fireEvent.pointerUp(target, { ...pointer, ...last });
      fireEvent.touchEnd(target, { touches: [], changedTouches: [last] });
    },
  };
}

/** Down in steps, as a drag goes: never a sync, and the circle never shows. */
function dragDown(touch: ReturnType<typeof finger>, x: number, from: number, to: number) {
  for (let y = from + 20; y <= to; y += 20) {
    touch.move(x, y);
    expect(screen.queryByRole('status', PULL)).toBeNull();
  }
  touch.up();
}

async function calendar(days: boolean) {
  if (days) {
    localStorage.setItem(
      'pecklist.calendar',
      JSON.stringify({ mode: 'days', days: 3, weeks: 4, hourHeight: 48, unscheduled: false }),
    );
  }
  const store = testStore();
  await store.getState().init();
  const zone = localTimeZone();
  const today = todayIn(zone, Date.now());
  store.getState().apply(
    (ctx, ws) =>
      createTask(ctx, ws, {
        title: 'Dentist',
        listId: inboxList(ws).id,
        schedule: { start: today, end: null, allDay: true, timeZone: zone },
      }).workspace,
  );
  await store.getState().flush();
  await renderApp('/calendar', store);
}

describe('a drag on the calendar is never also a pull to refresh', () => {
  it('turning the dial down round its ring', async () => {
    await calendar(false);
    const dial = await screen.findByRole('slider', { name: 'Weeks shown' });
    // The button is at 0,0, so the open dial's middle is kept on screen at 132,132.
    // More down than sideways from the first move: that is what pull to refresh takes.
    const touch = finger(dial, 0, 0);
    for (let step = 1; step <= 11; step += 1) {
      touch.move(step * 6, step * 20);
      expect(screen.queryByRole('status', PULL)).toBeNull();
    }
    touch.up();
    expect(dial).not.toHaveAttribute('aria-valuenow', '4');
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('a task held after a small settle, then dragged down', async () => {
    await calendar(true);
    const row = await screen.findByRole('button', { name: 'Dentist' });
    const touch = finger(row, 50, 100);
    // The finger settles a few px down before the hold picks the task up.
    touch.move(50, 103);
    await wait(400);
    dragDown(touch, 50, 103, 300);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('a swipe down on a task (no hold) still pulls to refresh', async () => {
    await calendar(true);
    const row = await screen.findByRole('button', { name: 'Dentist' });
    const touch = finger(row, 50, 100);
    for (let y = 120; y <= 300; y += 20) touch.move(50, y);
    expect(screen.getByRole('status', PULL)).toBeInTheDocument();
    touch.up();
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('a timeline bar held after a small settle, then dragged', async () => {
    const store = testStore();
    await store.getState().init();
    const zone = localTimeZone();
    const today = todayIn(zone, Date.now());
    let listId = '';
    store.getState().apply((ctx, ws) => {
      const made = createList(ctx, ws, { name: 'Garden', color: '#CFE3A3' });
      listId = made.list.id;
      return createTask(ctx, made.workspace, {
        title: 'Build beds',
        listId,
        schedule: { start: today, end: null, allDay: true, timeZone: zone },
      }).workspace;
    });
    await store.getState().flush();
    localStorage.setItem('pecklist.listLayouts', JSON.stringify({ [listId]: 'timeline' }));
    await renderApp(`/lists/${listId}`, store);
    const chart = await screen.findByRole('grid', { name: 'Timeline' });
    const bar = within(chart).getByRole('button', { name: 'Open Build beds' });
    const touch = finger(bar, 50, 100);
    touch.move(50, 103);
    await wait(400);
    dragDown(touch, 50, 103, 300);
    expect(syncNow).not.toHaveBeenCalled();
  });
});
