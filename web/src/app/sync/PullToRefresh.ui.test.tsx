import { act, createEvent, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testStore } from '../../test/renderApp.tsx';
import { claimTouches } from '../dnd/claimTouch.ts';
import { PullToRefresh } from './PullToRefresh.tsx';
import { SyncContext, standaloneSync } from './syncContext.ts';

// Pull down at the top to sync (installed app), and only that: a wobble before a hold, or a touch
// a grip claimed, is not a pull (the gesture conflict sweep, rc.4).

const touch = (y: number) => ({ touches: [{ clientX: 100, clientY: y, pageX: 100, pageY: y }] });
let now = 1_000_000;

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  // An installed app: where pulling to refresh is ours.
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('display-mode: standalone'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setUp() {
  const engine = standaloneSync(testStore());
  const syncNow = vi.fn(() => Promise.resolve());
  engine.setState({ phase: 'ready', syncNow } as never);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>
  );
  const view = render(
    <>
      <PullToRefresh />
      <div data-testid="page" />
    </>,
    { wrapper },
  );
  const page = view.getByTestId('page');
  // The circle: nothing is drawn until a pull starts.
  const circle = () => view.container.querySelector('.MuiPaper-root');
  return { page, syncNow, circle };
}

describe('pull to refresh', () => {
  it('a pull down at the top past the line syncs', async () => {
    const { page, syncNow, circle } = setUp();
    fireEvent.touchStart(page, touch(100));
    fireEvent.touchMove(page, touch(120));
    fireEvent.touchMove(page, touch(300));
    expect(circle()).not.toBeNull();
    await act(async () => {
      fireEvent.touchEnd(page);
      await Promise.resolve();
    });
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('a pull whose first px wobble sideways or up still syncs: its way is judged past the slop', async () => {
    const { page, syncNow, circle } = setUp();
    const at = (x: number, y: number) => ({
      touches: [{ clientX: x, clientY: y, pageX: x, pageY: y }],
    });
    fireEvent.touchStart(page, at(100, 100));
    fireEvent.touchMove(page, at(100, 103));
    fireEvent.touchMove(page, at(105, 104));
    fireEvent.touchMove(page, at(105, 99));
    fireEvent.touchMove(page, at(105, 130));
    fireEvent.touchMove(page, at(105, 300));
    expect(circle()).not.toBeNull();
    await act(async () => {
      fireEvent.touchEnd(page);
      await Promise.resolve();
    });
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('a wobble down before a hold is not a pull, nor is the drag after it', async () => {
    const { page, syncNow, circle } = setUp();
    fireEvent.touchStart(page, touch(100));
    const wobble = createEvent.touchMove(page, touch(104));
    fireEvent(page, wobble);
    expect(circle()).toBeNull();
    expect(wobble.defaultPrevented).toBe(false);
    // The hold arms a drag, which then goes down the page.
    now += 500;
    fireEvent.touchMove(page, touch(200));
    fireEvent.touchMove(page, touch(400));
    expect(circle()).toBeNull();
    await act(async () => {
      fireEvent.touchEnd(page);
      await Promise.resolve();
    });
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('a touch a grip claimed is never a pull', async () => {
    const { page, syncNow, circle } = setUp();
    const grip = document.createElement('span');
    page.append(grip);
    const stop = claimTouches(grip);
    fireEvent.touchStart(grip, touch(100));
    fireEvent.touchMove(grip, touch(130));
    fireEvent.touchMove(grip, touch(300));
    expect(circle()).toBeNull();
    await act(async () => {
      fireEvent.touchEnd(grip);
      await Promise.resolve();
    });
    expect(syncNow).not.toHaveBeenCalled();
    stop();
  });
});
