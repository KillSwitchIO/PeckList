import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import {
  PULL_FLING_MIN_PX,
  PULL_OPEN_SHARE,
  PULL_REST_MS,
  PULL_SETTLE_MS,
  pullOpens,
} from './usePullUp.ts';

const PANEL = { name: 'Comments and history' };
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const touch = (y: number) => ({ touches: [{ clientX: 100, clientY: y }] });

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('phone');
});

async function taskOpen() {
  const store = testStore();
  await renderApp('/inbox', store);
  act(() =>
    store
      .getState()
      .apply(
        (ctx, ws) =>
          createTask(ctx, ws, { title: 'Water plants', listId: inboxList(ws).id }).workspace,
      ),
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Open Water plants' }));
  const details = await screen.findByRole('region', { name: 'Task details' });
  const bar = within(details).getByRole('button', PANEL);
  return { details, bar };
}

const rootOf = (panel: HTMLElement) => panel.closest<HTMLElement>('.MuiDrawer-root')!;

/** The details as a long scroll, scrolled to `top` (1500 is the end). */
function longDetails(details: HTMLElement, top: number) {
  const box = details.querySelector<HTMLElement>('[data-add-subtask], .MuiStack-root')!;
  Object.defineProperty(box, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: 500, configurable: true });
  box.scrollTop = top;
  return box;
}

describe('pulling up the comments and history (R-FB-109)', () => {
  it('follows the finger, and slides back if it did not come far enough', async () => {
    const { bar } = await taskOpen();
    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(640));
    const panel = await screen.findByRole('dialog', PANEL);
    // 60 px of finger, less the 10 px it takes to tell a pull from a tap.
    expect(rootOf(panel).style.getPropertyValue('--pull-px')).toBe('50px');
    fireEvent.touchMove(bar, touch(630));
    expect(rootOf(panel).style.getPropertyValue('--pull-px')).toBe('60px');

    fireEvent.touchEnd(bar);
    await waitFor(() => expect(screen.queryByRole('dialog', PANEL)).toBeNull());
  });

  it('glides back rather than jumping: the glide is on before it moves', async () => {
    const { bar } = await taskOpen();
    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(630));
    const panel = await screen.findByRole('dialog', PANEL);
    const root = rootOf(panel);
    const set = root.style.setProperty.bind(root.style);
    let glideAsItMoved = '';
    vi.spyOn(root.style, 'setProperty').mockImplementation((name, value) => {
      if (name === '--pull-px' && value === '0px')
        glideAsItMoved = getComputedStyle(panel).transition;
      set(name, value);
    });
    // Straight from the browser, as a real finger is, not wrapped in a test's act().
    bar.dispatchEvent(createEvent.touchEnd(bar));
    expect(glideAsItMoved).toContain(`${PULL_SETTLE_MS}ms`);
    await waitFor(() => expect(screen.queryByRole('dialog', PANEL)).toBeNull());
  });

  it('eases between moves the browser only reports now and then, and follows the rest at once', async () => {
    const { bar } = await taskOpen();
    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(640));
    const root = rootOf(await screen.findByRole('dialog', PANEL));
    fireEvent.touchMove(bar, touch(630));
    expect(root.style.getPropertyValue('--pull-ease')).toBe('0ms');
    // Once a scroll has begun, Chrome reports moves it will not let be stopped, about 200 ms apart.
    fireEvent(bar, createEvent.touchMove(bar, { ...touch(600), cancelable: false }));
    expect(root.style.getPropertyValue('--pull-ease')).toBe('200ms');
    expect(getComputedStyle(screen.getByRole('dialog', PANEL)).transition).toContain('--pull-ease');
    fireEvent.touchEnd(bar);
  });

  it('a new pull just after one slid back is not ended by it', async () => {
    const { bar } = await taskOpen();
    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(640));
    await screen.findByRole('dialog', PANEL);
    fireEvent.touchEnd(bar);
    // Still sliding back when the finger comes down again.
    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(640));
    // Long enough for the old slide back to have ended: the sheet is still under the finger.
    await wait(PULL_SETTLE_MS + 100);
    const panel = screen.getByRole('dialog', PANEL);
    expect(getComputedStyle(panel).transform).toContain('--pull-px');
    fireEvent.touchEnd(bar);
    await waitFor(() => expect(screen.queryByRole('dialog', PANEL)).toBeNull());
  });

  it('a pull cut off by another touch still settles, never stuck half up', async () => {
    const { bar } = await taskOpen();
    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(640));
    await screen.findByRole('dialog', PANEL);
    // A second finger lands, with no end to the first.
    fireEvent.touchStart(bar, {
      touches: [
        { clientX: 100, clientY: 640 },
        { clientX: 200, clientY: 700 },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('dialog', PANEL)).toBeNull());
  });

  it('stays open once pulled about a third of its height', async () => {
    const { bar } = await taskOpen();
    const needed = window.innerHeight * PULL_OPEN_SHARE;
    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(700 - needed - 20));
    await screen.findByRole('dialog', PANEL);
    fireEvent.touchEnd(bar);
    await wait(PULL_SETTLE_MS + 100);
    expect(screen.getByRole('dialog', PANEL)).toBeInTheDocument();
  });

  it('a release that moved back down leaves it closed', async () => {
    const { bar } = await taskOpen();
    const needed = window.innerHeight * PULL_OPEN_SHARE;
    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(700 - needed - 20));
    fireEvent.touchMove(bar, touch(690));
    await screen.findByRole('dialog', PANEL);
    await wait(150);
    fireEvent.touchEnd(bar);
    await waitFor(() => expect(screen.queryByRole('dialog', PANEL)).toBeNull());
  });

  it('a fling so quick it delivers one move still opens it', async () => {
    const { bar } = await taskOpen();
    const at = (event: Event, ms: number) =>
      Object.defineProperty(event, 'timeStamp', { value: ms }) as Event;
    fireEvent(bar, at(createEvent.touchStart(bar, touch(700)), 1000));
    // Well short of a third of the height, so only its speed can open it.
    fireEvent(bar, at(createEvent.touchMove(bar, touch(550)), 1040));
    await screen.findByRole('dialog', PANEL);
    fireEvent(bar, at(createEvent.touchEnd(bar), 1045));
    await wait(PULL_SETTLE_MS + 100);
    expect(screen.getByRole('dialog', PANEL)).toBeInTheDocument();
  });

  it('a tap on the bar still opens it', async () => {
    const { bar } = await taskOpen();
    await userEvent.click(bar);
    expect(await screen.findByRole('dialog', PANEL)).toBeInTheDocument();
  });

  it('a scroll that reaches the end and carries on up stays a scroll: no pull in that touch', async () => {
    const { details } = await taskOpen();
    const box = longDetails(details, 0);

    fireEvent.touchStart(box, touch(700));
    fireEvent.touchMove(box, touch(400));
    // The scroll reaches the end with the finger at 400, and the finger keeps going up.
    box.scrollTop = 1500;
    fireEvent.scroll(box);
    const move = createEvent.touchMove(box, touch(300));
    fireEvent(box, move);
    fireEvent.touchMove(box, touch(200));
    await wait(50);
    expect(screen.queryByRole('dialog', PANEL)).toBeNull();
    // Nor is the scroll taken from the browser.
    expect(move.defaultPrevented).toBe(false);
    fireEvent.touchEnd(box);
  });

  it('a pull starts only from rest at the end, in a touch of its own', async () => {
    const { details } = await taskOpen();
    const box = longDetails(details, 1500);

    // A fling's momentum still scrolling: a touch now is not a pull.
    fireEvent.scroll(box);
    fireEvent.touchStart(box, touch(700));
    fireEvent.touchMove(box, touch(600));
    await wait(50);
    expect(screen.queryByRole('dialog', PANEL)).toBeNull();
    fireEvent.touchEnd(box);

    // At rest at the end, a new touch pulls.
    await wait(PULL_REST_MS + 50);
    fireEvent.touchStart(box, touch(700));
    fireEvent.touchMove(box, touch(670));
    const panel = await screen.findByRole('dialog', PANEL);
    expect(rootOf(panel).style.getPropertyValue('--pull-px')).toBe('20px');
    fireEvent.touchEnd(box);
    await waitFor(() => expect(screen.queryByRole('dialog', PANEL)).toBeNull());
  });

  it('takes a move up from rest at the end from its first pixel, so the browser starts no scroll', async () => {
    const { details } = await taskOpen();
    const box = longDetails(details, 1500);
    fireEvent.touchStart(box, touch(700));
    const first = createEvent.touchMove(box, touch(697));
    fireEvent(box, first);
    expect(first.defaultPrevented).toBe(true);
    fireEvent.touchEnd(box);
  });

  it('a touch at the end that first scrolls back up is a scroll, even when it comes back down', async () => {
    const { details } = await taskOpen();
    const box = longDetails(details, 1500);
    fireEvent.touchStart(box, touch(400));
    const down = createEvent.touchMove(box, touch(450));
    fireEvent(box, down);
    expect(down.defaultPrevented).toBe(false);
    box.scrollTop = 1450;
    fireEvent.touchMove(box, touch(400));
    box.scrollTop = 1500;
    fireEvent.touchMove(box, touch(300));
    await wait(50);
    expect(screen.queryByRole('dialog', PANEL)).toBeNull();
    fireEvent.touchEnd(box);
  });

  it('the details hold still while the panel comes up or is open, and scroll again once it closes', async () => {
    const { details, bar } = await taskOpen();
    const box = longDetails(details, 1500);
    const held = () => {
      const style = getComputedStyle(box);
      return style.overflowY === 'hidden' && style.touchAction === 'none';
    };
    expect(held()).toBe(false);
    expect(getComputedStyle(box).overscrollBehaviorY).toBe('contain');

    fireEvent.touchStart(bar, touch(700));
    fireEvent.touchMove(bar, touch(640));
    await screen.findByRole('dialog', PANEL);
    expect(held()).toBe(true);
    fireEvent.touchEnd(bar);
    await waitFor(() => expect(screen.queryByRole('dialog', PANEL)).toBeNull());
    await waitFor(() => expect(held()).toBe(false));

    await userEvent.click(bar);
    await screen.findByRole('dialog', PANEL);
    expect(held()).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', PANEL)).toBeNull());
    await waitFor(() => expect(held()).toBe(false));
  });

  it('a sideways swipe is not a pull', async () => {
    const { bar } = await taskOpen();
    fireEvent.touchStart(bar, { touches: [{ clientX: 100, clientY: 700 }] });
    fireEvent.touchMove(bar, { touches: [{ clientX: 300, clientY: 680 }] });
    fireEvent.touchMove(bar, { touches: [{ clientX: 310, clientY: 500 }] });
    await wait(50);
    expect(screen.queryByRole('dialog', PANEL)).toBeNull();
    fireEvent.touchEnd(bar);
  });
});

describe('whether a release leaves it open', () => {
  it('takes a third of its height, or a deliberate fling', () => {
    expect(pullOpens(200, 600, 0)).toBe(true);
    expect(pullOpens(199, 600, 0)).toBe(false);
    expect(pullOpens(PULL_FLING_MIN_PX, 600, 1)).toBe(true);
    // A quick flick that has barely moved it is not a fling, nor is a slow pull.
    expect(pullOpens(PULL_FLING_MIN_PX - 1, 600, 3)).toBe(false);
    expect(pullOpens(PULL_FLING_MIN_PX, 600, 0.5)).toBe(false);
  });
});
