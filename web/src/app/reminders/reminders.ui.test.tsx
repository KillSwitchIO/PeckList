import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import type { Reminder } from '../../core/types.ts';
import type { AppNotification, NotificationPermissionState } from '../../ports/notifier.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createBrowserNotifier } from '../../adapters/browser-notifier.ts';
import { setNotifier } from './notifier.ts';

function fakeNotifier(permission: NotificationPermissionState = 'granted') {
  const shown: AppNotification[] = [];
  let state = permission;
  const notifier = {
    shown,
    asked: 0,
    permission: () => state,
    request: () => {
      notifier.asked += 1;
      state = 'granted';
      return Promise.resolve(state);
    },
    show: (notification: AppNotification) => {
      shown.push(notification);
      return Promise.resolve();
    },
  };
  return notifier;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});
afterEach(() => setNotifier(createBrowserNotifier()));

/** A local date-time `minutes` from now, in the app's zone. */
function inMinutes(minutes: number): string {
  const at = new Date(Date.now() + minutes * 60_000);
  const date = todayIn(localTimeZone(), at.getTime());
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: localTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return `${date}T${time}`;
}

function addTask(
  store: ReturnType<typeof testStore>,
  title: string,
  start: string,
  reminders?: Reminder[],
) {
  let id = '';
  act(() =>
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, {
        title,
        listId: inboxList(ws).id,
        schedule: { start, end: null, allDay: false, timeZone: localTimeZone() },
        ...(reminders ? { reminders } : {}),
      });
      id = made.task.id;
      return made.workspace;
    }),
  );
  return id;
}

describe('reminders', () => {
  it('are set from the task details, asking for permission the first time', async () => {
    const notifier = fakeNotifier('default');
    setNotifier(notifier);
    const store = testStore();
    await renderApp('/inbox', store);
    const id = addTask(store, 'Dentist', inMinutes(24 * 60));
    await userEvent.click(screen.getByRole('button', { name: 'Open Dentist' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Reminders: None' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reminders' });
    await userEvent.click(within(sheet).getByRole('checkbox', { name: '30 minutes before' }));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: '1 day before' }));
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
    expect(task().reminders).toEqual([{ before: 30 }, { before: 1440 }]);
    expect(notifier.asked).toBe(1);
    await userEvent.click(within(sheet).getByRole('checkbox', { name: '30 minutes before' }));
    expect(task().reminders).toEqual([{ before: 1440 }]);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(
      within(details).getByRole('button', { name: 'Reminders: 1 day before' }),
    ).toBeInTheDocument();
  });

  it('fire once when due, a little late after a sleep, and not for closed tasks', async () => {
    const notifier = fakeNotifier();
    setNotifier(notifier);
    const store = testStore();
    await renderApp('/inbox', store);
    // Due five minutes ago: still within the grace, so it fires now.
    addTask(store, 'Take the pills', inMinutes(5), [{ before: 10 }]);
    // An hour ago: too late to bother.
    addTask(store, 'Old news', inMinutes(-60), [{ before: 0 }]);
    // Not yet.
    addTask(store, 'Later on', inMinutes(120), [{ before: 0 }]);
    expect(notifier.shown.map((each) => each.title)).toEqual(['Take the pills']);
    expect(notifier.shown[0]!.url).toMatch(/^\/today\?task=/);
    // Another change to the data looks again but does not fire it twice.
    addTask(store, 'Unrelated', inMinutes(300));
    expect(notifier.shown).toHaveLength(1);
  });
});
