import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import type { NotificationAction, Notifier } from '../../ports/notifier.ts';
import { testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { notifier, setNotifier } from '../reminders/notifier.ts';
import { AppRoutes } from '../routes.tsx';
import { NotificationOpen } from './NotificationOpen.tsx';

const browser = notifier();
afterEach(() => setNotifier(browser));

/** Android's notifications, faked: the test plays the taps. */
function tapping() {
  let tap: ((url: string, action?: NotificationAction) => void) | null = null;
  const fake: Notifier = {
    permission: () => 'granted',
    request: () => Promise.resolve('granted'),
    show: () => Promise.resolve(),
    onOpen: (handler) => {
      tap = handler;
      return () => undefined;
    },
  };
  setNotifier(fake);
  return (url: string, action?: NotificationAction) => tap!(url, action);
}

async function withTask(title: string) {
  const store = testStore();
  let taskId = '';
  render(
    <AppProviders store={store}>
      <MemoryRouter initialEntries={['/inbox']}>
        <AppRoutes />
        <NotificationOpen />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1 }, { timeout: 10_000 });
  act(() =>
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, { title, listId: inboxList(ws).id });
      taskId = made.task.id;
      return made.workspace;
    }),
  );
  const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === taskId)!;
  return { taskId, task };
}

describe('android: a reminder button the app finishes', () => {
  it('completes the task (offline, standalone, or a repeating task)', async () => {
    const tap = tapping();
    const { taskId, task } = await withTask('Water plants');
    act(() => tap(`/today?task=${taskId}`, { action: 'complete', taskId, minutes: 10 }));
    await waitFor(() => expect(task().status).toBe('done'));
  });

  it('snoozes it, with a reminder that syncs like any other', async () => {
    const tap = tapping();
    const { taskId, task } = await withTask('Call mum');
    act(() => tap(`/today?task=${taskId}`, { action: 'snooze', taskId, minutes: 10 }));
    await waitFor(() => expect(task().reminders).toHaveLength(1));
    expect(task().status).toBe('open');
    expect(task().reminders![0]).toHaveProperty('at');
  });
});
