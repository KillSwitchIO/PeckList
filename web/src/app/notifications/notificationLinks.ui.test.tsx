import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEntity, putEntity } from '../../core/collections.ts';
import { commentsOf } from '../../core/comments.ts';
import { inboxList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { assigneesOf, setAssignee } from '../../core/sharing.ts';
import { createTask } from '../../core/tasks.ts';
import type { GroupMember } from '../../core/types.ts';
import { mockViewport, testStore } from '../../test/renderApp.tsx';
import { openedOf } from '../../adapters/shell-notifier.ts';
import { NotificationOpen } from '../native/NotificationOpen.tsx';
import { AppProviders } from '../providers.tsx';
import { notifier, setNotifier } from '../reminders/notifier.ts';
import { AppRoutes } from '../routes.tsx';
import { THUMBS_UP } from './NotificationLinks.tsx';

// With the real BrowserRouter, as in the app. It applies navigation as a transition, and the bug
// this pins lives in the timing between that and the store's own synchronous updates.

const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** The address changing under a running app, the way a tapped notification's link arrives. */
const goTo = (url: string) =>
  act(() => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

const browser = notifier();

beforeEach(() => {
  setNotifier(browser);
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
  window.history.replaceState(null, '', '/inbox');
});

afterEach(() => window.history.replaceState(null, '', '/'));

/** The app running on the Mess Drawer with one task, on the real router. */
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
  act(() =>
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, { title: 'Water it', listId: inboxList(ws).id });
      taskId = made.task.id;
      return made.workspace;
    }),
  );
  const thumbs = () =>
    commentsOf(store.getState().workspace!, taskId).filter((each) => each.body === THUMBS_UP)
      .length;
  return { store, taskId, thumbs };
}

describe('a notification button opening the app', () => {
  it('leaves one thumbs up, and the address forgets it', async () => {
    const { taskId, thumbs } = await appWithTask();
    goTo(`/inbox?task=${taskId}&like=1`);
    await waitFor(() => expect(window.location.search).not.toContain('like=1'));
    await pause(300);
    expect(thumbs()).toBe(1);
    expect(window.location.search).toContain(`task=${taskId}`);
  });

  it('leaves one when the Android app hands the press over', async () => {
    let press: (url: string) => void = () => undefined;
    setNotifier({
      ...browser,
      onOpen: (handler) => {
        press = handler;
        return () => undefined;
      },
    });
    const { taskId, thumbs } = await appWithTask();
    // The event the shell sends for the notification's button.
    act(() => press(openedOf({ url: `/inbox?task=${taskId}&like=1` })!.url));
    await waitFor(() => expect(window.location.search).not.toContain('like=1'));
    await pause(300);
    expect(thumbs()).toBe(1);
    expect(window.location.search).toContain(`task=${taskId}`);
  });

  it('leaves one more for each later press, not none', async () => {
    const { taskId, thumbs } = await appWithTask();
    for (const count of [1, 2]) {
      goTo(`/inbox?task=${taskId}&like=1`);
      await waitFor(() => expect(window.location.search).not.toContain('like=1'));
      await pause(100);
      expect(thumbs()).toBe(count);
    }
  });

  it('waits for a task that has not arrived, then leaves one', async () => {
    const { store } = await appWithTask();
    let arrived: ReturnType<typeof createTask> | undefined;
    // The task exists elsewhere, as on a phone opening before the first sync brings it.
    act(() =>
      store.getState().apply((ctx, ws) => {
        arrived = createTask(ctx, ws, { title: 'Feed it', listId: inboxList(ws).id });
        return ws;
      }),
    );
    const { task, workspace } = arrived!;
    goTo(`/inbox?task=${task.id}&like=1`);
    await pause(100);
    expect(window.location.search).toContain('like=1');

    act(() => store.getState().apply(() => workspace));
    await waitFor(() => expect(window.location.search).not.toContain('like=1'));
    await pause(300);
    expect(commentsOf(store.getState().workspace!, task.id)).toHaveLength(1);
  });

  it('calls dibs on a task of my group, and the address forgets it', async () => {
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
    goTo(`/inbox?task=${taskId}&dibs=1`);
    await waitFor(() => expect(window.location.search).not.toContain('dibs=1'));
    await pause(300);
    const { workspace, context } = store.getState();
    expect(assigneesOf(getEntity(workspace!, 'tasks', taskId)!)).toEqual([
      `user:${context().userId}`,
    ]);
    expect(window.location.search).toContain(`task=${taskId}`);
  });
});
