import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEntity, putEntity } from '../../core/collections.ts';
import { commentsOf } from '../../core/comments.ts';
import { localTimeZone } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { assigneesOf, setAssignee } from '../../core/sharing.ts';
import { reminderInstant } from '../../core/reminders.ts';
import { createTask, updateTask } from '../../core/tasks.ts';
import type { GroupMember } from '../../core/types.ts';
import { mockViewport, testStore } from '../../test/renderApp.tsx';
import { openedOf } from '../../adapters/shell-notifier.ts';
import type { NotificationAction } from '../../ports/notifier.ts';
import { NotificationOpen } from '../native/NotificationOpen.tsx';
import { AppProviders } from '../providers.tsx';
import { notifier, setNotifier } from '../reminders/notifier.ts';
import { AppRoutes } from '../routes.tsx';
import { THUMBS_UP } from './NotificationLinks.tsx';
import { ACTIONS_CACHE, ACTION_TTL_MS } from './notificationActions.ts';

// With the real BrowserRouter, as in the app. It applies navigation as a transition, and the bug
// this once pinned lives in the timing between that and the store's own synchronous updates.
//
// A thumbs up or dibs comes only from a real press (security review 2026-11-19): the service
// worker's one-time ?act= name over an entry in Cache Storage, or the Android app's press. A
// like=1 or dibs=1 in an address, which any link could carry, does nothing.

const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** The address changing under a running app, the way a tapped notification's link arrives. */
const goTo = (url: string) =>
  act(() => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

/** This origin's Cache Storage, as the service worker and the page share it (jsdom has none). */
function fakeCaches() {
  const stores = new Map<string, Map<string, string>>();
  const path = (request: RequestInfo | URL) =>
    new URL(
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url,
      'http://localhost',
    ).pathname;
  const caches = {
    open: (name: string) => {
      const store = stores.get(name) ?? new Map<string, string>();
      stores.set(name, store);
      return Promise.resolve({
        put: async (request: RequestInfo, response: Response) => {
          store.set(path(request), await response.text());
        },
        match: (request: RequestInfo) =>
          Promise.resolve(
            store.has(path(request)) ? new Response(store.get(path(request))) : undefined,
          ),
        delete: (request: RequestInfo) => Promise.resolve(store.delete(path(request))),
        keys: () =>
          Promise.resolve([...store.keys()].map((key) => new Request(`http://localhost${key}`))),
      });
    },
  };
  vi.stubGlobal('caches', caches);
  const entries = () => {
    const store = stores.get(ACTIONS_CACHE) ?? new Map<string, string>();
    stores.set(ACTIONS_CACHE, store);
    return store;
  };
  let made = 0;
  /** What the service worker keeps for a press; its one-time name. */
  const press = (
    kind: 'like' | 'dibs' | 'complete',
    taskId: string,
    at = Date.now(),
    first?: number,
  ) => {
    made += 1;
    const name = `${'n'.repeat(20)}${String(made).padStart(2, '0')}`;
    entries().set(
      `/act/${name}`,
      JSON.stringify({ kind, taskId, at, ...(first !== undefined ? { first } : {}) }),
    );
    return name;
  };
  return { press, entries };
}

const browser = notifier();

beforeEach(() => {
  setNotifier(browser);
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
  window.history.replaceState(null, '', '/inbox');
});

afterEach(() => window.history.replaceState(null, '', '/'));

/** The app running on the Mess Drawer with two tasks, on the real router. */
async function appWithTask() {
  const store = testStore();
  render(
    <AppProviders store={store}>
      <BrowserRouter>
        <NotificationOpen />
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Mess Drawer' }, { timeout: 10_000 });
  let taskId = '';
  let otherId = '';
  act(() =>
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, { title: 'Water it', listId: inboxList(ws).id });
      const other = createTask(ctx, made.workspace, { title: 'Feed it', listId: inboxList(ws).id });
      taskId = made.task.id;
      otherId = other.task.id;
      return other.workspace;
    }),
  );
  const thumbsOn = (id: string) =>
    commentsOf(store.getState().workspace!, id).filter((each) => each.body === THUMBS_UP).length;
  const thumbs = () => thumbsOn(taskId);
  return { store, taskId, otherId, thumbs, thumbsOn };
}

/** The Android app's press handed over, as its notificationOpen event. */
function shellPress() {
  let press: (url: string, action?: NotificationAction) => void = () => undefined;
  setNotifier({
    ...browser,
    onOpen: (handler) => {
      press = handler;
      return () => undefined;
    },
  });
  return (event: Parameters<typeof openedOf>[0]) => {
    const opened = openedOf(event)!;
    act(() => press(opened.url, opened.action));
  };
}

describe('a notification button opening the app', () => {
  it('a thumbs up pressed in a browser notification leaves one, and the address forgets it', async () => {
    const { press, entries } = fakeCaches();
    const { taskId, thumbs } = await appWithTask();
    const name = press('like', taskId);
    goTo(`/inbox?task=${taskId}&act=${name}`);
    await waitFor(() => expect(window.location.search).not.toContain('act='));
    await waitFor(() => expect(thumbs()).toBe(1));
    expect(window.location.search).toContain(`task=${taskId}`);
    // Taken: gone from the cache, so Back to the same address (or a second tab) does nothing.
    expect(entries().size).toBe(0);
    goTo(`/inbox?task=${taskId}&act=${name}`);
    await waitFor(() => expect(window.location.search).not.toContain('act='));
    await pause(300);
    expect(thumbs()).toBe(1);
  });

  it('a like=1 or dibs=1 in an address, as any link can carry, does nothing and is dropped', async () => {
    fakeCaches();
    const { taskId, thumbs } = await appWithTask();
    goTo(`/inbox?task=${taskId}&like=1`);
    await waitFor(() => expect(window.location.search).not.toContain('like=1'));
    goTo(`/inbox?task=${taskId}&dibs=1&act=made-up`);
    await waitFor(() => expect(window.location.search).not.toContain('dibs=1'));
    await pause(300);
    expect(thumbs()).toBe(0);
    expect(window.location.search).toContain(`task=${taskId}`);
  });

  it("a press for one task opened on another task's address acts on its own task, never the other", async () => {
    const { press } = fakeCaches();
    const { taskId, otherId, thumbsOn } = await appWithTask();
    goTo(`/inbox?task=${otherId}&act=${press('like', taskId)}`);
    await waitFor(() => expect(thumbsOn(taskId)).toBe(1));
    await pause(300);
    expect(thumbsOn(otherId)).toBe(0);
  });

  it('a press older than two minutes does nothing, and stale ones are cleared', async () => {
    const { press, entries } = fakeCaches();
    const { taskId, thumbs } = await appWithTask();
    const old = Date.now() - ACTION_TTL_MS - 1000;
    press('like', taskId, old);
    const name = press('like', taskId, old);
    goTo(`/inbox?task=${taskId}&act=${name}`);
    await waitFor(() => expect(window.location.search).not.toContain('act='));
    await pause(300);
    expect(thumbs()).toBe(0);
    expect(entries().size).toBe(0);
  });

  it('leaves one more for each later press, not none', async () => {
    const { press } = fakeCaches();
    const { taskId, thumbs } = await appWithTask();
    for (const count of [1, 2]) {
      goTo(`/inbox?task=${taskId}&act=${press('like', taskId)}`);
      await waitFor(() => expect(thumbs()).toBe(count));
    }
  });

  it('leaves one when the Android app hands the press over, not for its address', async () => {
    const tap = shellPress();
    const { taskId, thumbs } = await appWithTask();
    // An older shell's button: only the address, which no longer acts.
    tap({ url: `/inbox?task=${taskId}&like=1` });
    await waitFor(() => expect(window.location.search).not.toContain('like=1'));
    await pause(200);
    expect(thumbs()).toBe(0);
    tap({ url: `/inbox?task=${taskId}`, action: 'like', taskId });
    await waitFor(() => expect(thumbs()).toBe(1));
    await pause(200);
    expect(thumbs()).toBe(1);
  });

  it('waits for a task that has not arrived, then leaves one', async () => {
    const tap = shellPress();
    const { store } = await appWithTask();
    let arrived: ReturnType<typeof createTask> | undefined;
    // The task exists elsewhere, as on a phone opening before the first sync brings it.
    act(() =>
      store.getState().apply((ctx, ws) => {
        arrived = createTask(ctx, ws, { title: 'Prune it', listId: inboxList(ws).id });
        return ws;
      }),
    );
    const { task, workspace } = arrived!;
    tap({ url: `/inbox?task=${task.id}`, action: 'like', taskId: task.id });
    await pause(100);
    act(() => store.getState().apply(() => workspace));
    await waitFor(() => expect(commentsOf(store.getState().workspace!, task.id)).toHaveLength(1));
  });

  it('calls dibs on a task of my group from a browser notification', async () => {
    const { press } = fakeCaches();
    const { store, taskId } = await appWithTask();
    const group = '01JBGR0000000000000000000G';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const member = createEntity<GroupMember>(ctx, {
          groupId: group,
          userId: ctx.userId,
          joinedAt: new Date().toISOString(),
          state: 'active',
        });
        return setAssignee(
          ctx,
          putEntity(ws, 'groupMembers', member),
          taskId,
          `group:${group}`,
          true,
        );
      }),
    );
    goTo(`/inbox?task=${taskId}&act=${press('dibs', taskId)}`);
    await waitFor(() => {
      const { workspace, context } = store.getState();
      expect(assigneesOf(getEntity(workspace!, 'tasks', taskId)!)).toEqual([
        `user:${context().userId}`,
      ]);
    });
    expect(window.location.search).toContain(`task=${taskId}`);
    expect(window.location.search).not.toContain('act=');
  });

  it("a reminder's Complete completes its task once, and only from a real press", async () => {
    // Ben (2026-11-20): "Web reminders should have a complete button".
    const { press, entries } = fakeCaches();
    const { store, taskId, otherId } = await appWithTask();
    const status = (id: string) => getEntity(store.getState().workspace!, 'tasks', id)!.status;
    // An address alone, as any link could carry, completes nothing.
    goTo(`/today?complete=1&task=${taskId}&act=made-up`);
    await waitFor(() => expect(window.location.search).not.toContain('act='));
    await pause(300);
    expect(status(taskId)).toBe('open');

    const name = press('complete', taskId);
    goTo(`/today?task=${otherId}&act=${name}`);
    await waitFor(() => expect(status(taskId)).toBe('done'));
    expect(status(otherId)).toBe('open');
    expect(entries().size).toBe(0);
    expect(await screen.findByText('Task completed')).toBeInTheDocument();
    // The same name again (Back, a reload) does nothing; a done task is never opened again.
    goTo(`/today?act=${name}`);
    goTo(`/today?act=${press('complete', taskId)}`);
    await waitFor(() => expect(window.location.search).not.toContain('act='));
    await pause(300);
    expect(status(taskId)).toBe('done');
  });

  it("a reminder's Complete left up from an occurrence already gone does nothing", async () => {
    // Dev 2's review: ticked on the phone (it moved on), then Complete pressed on a notice here.
    const { press } = fakeCaches();
    const { store } = await appWithTask();
    let id = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, {
          title: 'Take the pills',
          listId: inboxList(ws).id,
          schedule: {
            start: '2026-11-20T10:30',
            end: null,
            allDay: false,
            timeZone: localTimeZone(),
          },
          reminders: [{ before: 0 }],
          recurrence: 'FREQ=DAILY',
        });
        id = made.task.id;
        return made.workspace;
      }),
    );
    const task = () => getEntity(store.getState().workspace!, 'tasks', id)!;
    const thursday = reminderInstant(task(), { before: 0 }, localTimeZone())!;
    // Ticked elsewhere: it is on Friday now.
    act(() =>
      store.getState().apply((ctx, ws) =>
        updateTask(ctx, ws, id, {
          schedule: { ...task().schedule!, start: '2026-11-21T10:30' },
        }),
      ),
    );
    goTo(`/today?act=${press('complete', id, Date.now(), thursday)}`);
    await waitFor(() => expect(window.location.search).not.toContain('act='));
    await pause(300);
    expect(task().status).toBe('open');
    expect(task().schedule!.start).toBe('2026-11-21T10:30');

    // Friday's own reminder completes Friday (and moves it on to Saturday).
    const friday = reminderInstant(task(), { before: 0 }, localTimeZone())!;
    goTo(`/today?act=${press('complete', id, Date.now(), friday)}`);
    await waitFor(() => expect(task().schedule!.start > '2026-11-21T10:30').toBe(true));
  });

  it("a reminder's Complete on a repeating task moves it to its next date", async () => {
    const { press } = fakeCaches();
    const { store } = await appWithTask();
    let id = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, {
          title: 'Take the bins out',
          listId: inboxList(ws).id,
          schedule: { start: '2026-11-20', end: null, allDay: true, timeZone: localTimeZone() },
          recurrence: 'FREQ=WEEKLY',
        });
        id = made.task.id;
        return made.workspace;
      }),
    );
    goTo(`/today?act=${press('complete', id)}`);
    await waitFor(() => {
      const task = getEntity(store.getState().workspace!, 'tasks', id)!;
      // This occurrence closes as a copy, and the task itself moves on (as its checkbox does).
      expect(task.status).toBe('open');
      expect(task.schedule!.start > '2026-11-20').toBe(true);
    });
    const done = store
      .getState()
      .workspace!.entities.tasks.filter((each) => each.title === 'Take the bins out');
    expect(done.map((each) => each.status).sort()).toEqual(['done', 'open']);
  });
});
