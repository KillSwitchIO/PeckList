import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask, toggleTaskDone } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

/** An IntersectionObserver the test drives: `reach()` says the spacer came near. */
class FakeObserver {
  static all: FakeObserver[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe() {}
  disconnect() {
    FakeObserver.all = FakeObserver.all.filter((each) => each !== this);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  static reach() {
    for (const observer of [...FakeObserver.all]) {
      observer.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    }
  }
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe('long lists of closed tasks', () => {
  it('draw as they scroll near, keeping the whole height (R-FB-94)', async () => {
    const store = testStore();
    await renderApp('/completed', store);
    act(() =>
      store.getState().apply((ctx, ws) => {
        let next = ws;
        for (let index = 0; index < 300; index += 1) {
          const made = createTask(ctx, next, {
            title: `Done ${index}`,
            listId: inboxList(next).id,
          });
          next = toggleTaskDone(ctx, made.workspace, made.task.id);
        }
        return next;
      }),
    );
    const rows = () => screen.getAllByRole('button', { name: /^Open Done / }).length;
    expect(rows()).toBe(60);
    // The rest of the list keeps its place, so the scroll bar is the whole list's.
    const spacer = document.querySelector<HTMLElement>('[aria-hidden][style*="height"]');
    expect(spacer?.style.height).toBe(`${240 * 44}px`);
    act(() => FakeObserver.reach());
    expect(rows()).toBe(210);
    act(() => FakeObserver.reach());
    expect(rows()).toBe(300);
    expect(document.querySelector('[aria-hidden][style*="height"]')).toBeNull();
  });
});
