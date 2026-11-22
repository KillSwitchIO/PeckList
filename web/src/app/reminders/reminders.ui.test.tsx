import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { updateSettings } from '../../core/settings.ts';
import { createTask, updateTask } from '../../core/tasks.ts';
import type { Reminder } from '../../core/types.ts';
import type {
  AppNotification,
  NotificationPermissionState,
  ScheduledNotification,
} from '../../ports/notifier.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { createBrowserNotifier } from '../../adapters/browser-notifier.ts';
import { setNotifier } from './notifier.ts';
import { formatTime } from '../format.ts';
import { sameSnoozes } from '../../core/reminders.ts';

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
    const sheet = await screen.findByRole('dialog', { name: 'Reminder' });
    const choice = (name: string | RegExp) => within(sheet).getByRole('menuitemcheckbox', { name });
    await userEvent.click(choice('30 minutes early'));
    await userEvent.click(choice('1 day early'));
    await userEvent.click(choice('30 minutes early'));
    // Nothing changes until OK.
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
    expect(task().reminders ?? []).toEqual([]);
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Constant reminder' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'OK' }));
    expect(task().reminders).toEqual([{ before: 1440 }]);
    expect(task().constantReminder).toBe(true);
    expect(notifier.asked).toBe(1);
    expect(
      within(details).getByRole('button', { name: 'Reminders: 1 day early' }),
    ).toBeInTheDocument();
  });

  // Its own test, not the end of the one above: each walk is half as long, and so half as near
  // the timeout on a busy runner (the two together took 8.4 s on CI).
  it('take a custom time from the Hour tab’s wheel, beside the ones set', async () => {
    setNotifier(fakeNotifier('granted'));
    const store = testStore();
    await renderApp('/inbox', store);
    // One reminder already, so the custom one is added after it, not instead (Dev 2).
    const id = addTask(store, 'Dentist', inMinutes(24 * 60), [{ before: 1440 }]);
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
    await userEvent.click(screen.getByRole('button', { name: 'Open Dentist' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    // Custom: 2 hours early, from the Hour tab's wheel.
    await userEvent.click(within(details).getByRole('button', { name: 'Reminders: 1 day early' }));
    const again = await screen.findByRole('dialog', { name: 'Reminder' });
    await userEvent.click(within(again).getByRole('menuitemcheckbox', { name: /Custom/ }));
    await userEvent.click(within(again).getByRole('tab', { name: 'Hour' }));
    await userEvent.click(
      within(within(again).getByRole('listbox', { name: 'How early' })).getByRole('option', {
        name: '2 hours early',
      }),
    );
    expect(within(again).getByRole('status')).toHaveTextContent(/^Remind at /);
    await userEvent.click(within(again).getByRole('button', { name: 'Done' }));
    expect(within(again).getByRole('menuitemcheckbox', { name: '2 hours early' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(again).getByRole('button', { name: 'OK' }));
    expect(task().reminders).toEqual([{ before: 1440 }, { before: 120 }]);
  });

  it("offer an all-day task's reminders at the person's time (R-FB-83)", async () => {
    setNotifier(fakeNotifier('granted'));
    const store = testStore();
    await renderApp('/inbox', store);
    store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { allDayReminderTime: '07:30' }));
    const id = addTask(store, 'Water plants', inMinutes(3 * 24 * 60).slice(0, 10));
    await userEvent.click(screen.getByRole('button', { name: 'Open Water plants' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Reminders: None' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reminder' });
    const onTheDay = within(sheet).getByRole('menuitemcheckbox', { name: /^On the day/ });
    expect(onTheDay).toHaveTextContent(/7:30/);
    await userEvent.click(onTheDay);
    await userEvent.click(within(sheet).getByRole('button', { name: 'OK' }));
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
    expect(task().reminders).toEqual([{ before: 90 }]);
  });

  it('remind an all-day task on the day at a later time, and say when it has passed', async () => {
    setNotifier(fakeNotifier('granted'));
    const store = testStore();
    await renderApp('/inbox', store);
    const id = addTask(store, 'Water plants', inMinutes(3 * 24 * 60).slice(0, 10));
    await userEvent.click(screen.getByRole('button', { name: 'Open Water plants' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Reminders: None' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reminder' });
    // The quick list for a whole day, each at 9:00.
    expect(within(sheet).getByRole('menuitemcheckbox', { name: /^On the day/ })).toHaveTextContent(
      /9:00/,
    );
    await userEvent.click(within(sheet).getByRole('menuitemcheckbox', { name: /Custom/ }));
    await userEvent.click(
      within(within(sheet).getByRole('listbox', { name: 'How early' })).getByRole('option', {
        name: 'On the day',
      }),
    );
    await userEvent.click(
      within(within(sheet).getByRole('listbox', { name: 'Hour' })).getByRole('option', {
        name: '10',
      }),
    );
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'OK' }));
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
    expect(task().reminders).toEqual([{ before: -60 }]);
    expect(
      within(details).getByRole('button', { name: /^Reminders: On the day \(10:00/ }),
    ).toBeInTheDocument();

    // A week early is already gone for a task three days out.
    await userEvent.click(within(details).getByRole('button', { name: /^Reminders: / }));
    const again = await screen.findByRole('dialog', { name: 'Reminder' });
    await userEvent.click(within(again).getByRole('menuitemcheckbox', { name: /Custom/ }));
    await userEvent.click(within(again).getByRole('tab', { name: 'Week' }));
    expect(within(again).getByRole('status')).toHaveTextContent('The reminder has expired.');
  });

  it('remind a timed task days early at a time of their own (R-FB-91)', async () => {
    setNotifier(fakeNotifier('granted'));
    const store = testStore();
    await renderApp('/inbox', store);
    const id = addTask(store, 'Renew passport', `${inMinutes(90 * 24 * 60).slice(0, 10)}T10:00`);
    await userEvent.click(screen.getByRole('button', { name: 'Open Renew passport' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Reminders: None' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reminder' });
    await userEvent.click(within(sheet).getByRole('menuitemcheckbox', { name: /Custom/ }));
    await userEvent.click(within(sheet).getByRole('tab', { name: 'Day' }));
    const wheel = (name: string) => within(within(sheet).getByRole('listbox', { name }));
    await userEvent.click(wheel('How early').getByRole('option', { name: '60 days early' }));
    // The time wheels start at the task's own time (10:00 AM): 4 PM.
    await userEvent.click(wheel('Hour').getByRole('option', { name: '4' }));
    await userEvent.click(wheel('AM or PM').getByRole('option', { name: 'PM' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'OK' }));
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
    // 60 days before 10:00, then 6 hours later that day.
    expect(task().reminders).toEqual([{ before: 60 * 1440 - 360 }]);
    expect(
      within(details).getByRole('button', { name: /^Reminders: 60 days early \(4:00/ }),
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

  it("name the task's own time, not the time the reminder comes (Ben, 0.14.0-rc.1)", async () => {
    const notifier = fakeNotifier();
    setNotifier(notifier);
    const store = testStore();
    await renderApp('/inbox', store);
    // Starts in five minutes, reminded ten minutes before: the reminder came five minutes ago.
    const start = inMinutes(5);
    addTask(store, 'Take the pills', start, [{ before: 10 }]);
    const [day, time] = start.split('T') as [string, string];
    const today = todayIn(localTimeZone(), Date.now());
    expect(notifier.shown.map((each) => each.body)).toEqual([
      day === today ? `Starts ${formatTime(time)}` : `Starts tomorrow, ${formatTime(time)}`,
    ]);
  });

  it('carry Complete, for their own task; a constant one adds Snooze and Dismiss after it', async () => {
    // Ben (2026-11-20): "Web reminders should have a complete button".
    const notifier = fakeNotifier();
    setNotifier(notifier);
    const store = testStore();
    await renderApp('/inbox', store);
    const plain = addTask(store, 'Take the pills', inMinutes(5), [{ before: 10 }]);
    let constant = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, {
          title: 'Water plants',
          listId: inboxList(ws).id,
          schedule: { start: inMinutes(5), end: null, allDay: false, timeZone: localTimeZone() },
          reminders: [{ before: 10 }],
        });
        constant = made.task.id;
        return updateTask(ctx, made.workspace, made.task.id, { constantReminder: true });
      }),
    );
    const of = (title: string) => notifier.shown.find((each) => each.title === title)!;
    expect(of('Take the pills').actions).toEqual([
      { action: 'complete', title: 'Complete', url: '/today', taskId: plain },
    ]);
    expect(of('Take the pills').sticky).toBeUndefined();
    expect(of('Water plants').sticky).toBe(true);
    expect(of('Water plants').actions).toEqual([
      { action: 'complete', title: 'Complete', url: '/today', taskId: constant },
      { action: 'snooze', title: 'Snooze 10 min' },
      { action: 'dismiss', title: 'Dismiss' },
    ]);
  });

  it('in the Android app go to the system ahead of time, and the page shows none itself', async () => {
    const handed: ScheduledNotification[][] = [];
    const notifier = {
      ...fakeNotifier(),
      scheduleAhead: (notifications: ScheduledNotification[]) => {
        handed.push(notifications);
        return Promise.resolve();
      },
    };
    setNotifier(notifier);
    const store = testStore();
    await renderApp('/inbox', store);
    addTask(store, 'Take the pills', inMinutes(5), [{ before: 10 }]);
    addTask(store, 'Call mum', inMinutes(120), [{ before: 0 }, { before: 30 }]);
    addTask(store, 'Next month', inMinutes(40 * 24 * 60), [{ before: 0 }]);
    await waitFor(() => expect(handed.length).toBeGreaterThan(0), { timeout: 3000 });
    const last = handed.at(-1)!;
    // Only what is still to come, within two weeks, soonest first.
    expect(last.map((each) => each.title)).toEqual(['Call mum', 'Call mum']);
    expect(last[0]!.at).toBeLessThan(last[1]!.at);
    expect(last[0]!.url).toMatch(/^\/today\?task=/);
    expect(new Set(last.map((each) => each.tag)).size).toBe(2);
    // The one due now is the system's to show; the page only notes it.
    expect(notifier.shown).toEqual([]);
    // No server: nothing is waiting to reach one.
    expect(last.some((each) => each.local)).toBe(false);
  });

  it('marks reminders for tasks the server has not had yet, for the Android check-in (audit E2)', async () => {
    const handed: ScheduledNotification[][] = [];
    setNotifier({
      ...fakeNotifier(),
      scheduleAhead: (notifications: ScheduledNotification[]) => {
        handed.push(notifications);
        return Promise.resolve();
      },
    });
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const transport = backend.device();
    transport.session = 'ben';
    const store = testStore();
    const sync = createSyncEngine({
      transport,
      workspace: store,
      storage: createMemoryStorage(),
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    await renderApp('/inbox', store, sync);
    await waitFor(() => expect(sync.getState().phase).toBe('ready'));
    addTask(store, 'Synced', inMinutes(120), [{ before: 0 }]);
    await act(() => sync.getState().syncNow());
    transport.offline = true;
    addTask(store, 'Added offline', inMinutes(180), [{ before: 0 }]);
    await waitFor(
      () => expect(handed.at(-1)?.map((each) => each.title)).toEqual(['Synced', 'Added offline']),
      { timeout: 3000 },
    );
    expect(handed.at(-1)!.map((each) => each.local === true)).toEqual([false, true]);

    // A sync that reaches the task says it is local no longer.
    transport.offline = false;
    await act(() => sync.getState().syncNow());
    await waitFor(() => expect(handed.at(-1)!.some((each) => each.local)).toBe(false), {
      timeout: 3000,
    });
  });

  it('hands reminders over only when they change, not at every sync', async () => {
    const handed: ScheduledNotification[][] = [];
    setNotifier({
      ...fakeNotifier(),
      scheduleAhead: (notifications: ScheduledNotification[]) => {
        handed.push(notifications);
        return Promise.resolve();
      },
    });
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const transport = backend.device();
    transport.session = 'ben';
    const store = testStore();
    const sync = createSyncEngine({
      transport,
      workspace: store,
      storage: createMemoryStorage(),
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    await renderApp('/inbox', store, sync);
    await waitFor(() => expect(sync.getState().phase).toBe('ready'));
    addTask(store, 'Synced', inMinutes(120), [{ before: 0 }]);
    await act(() => sync.getState().syncNow());
    await waitFor(() => expect(handed.at(-1)?.map((each) => each.title)).toEqual(['Synced']), {
      timeout: 3000,
    });
    await act(() => new Promise((settle) => setTimeout(settle, 1200)));
    const before = handed.length;
    expect(before).toBeGreaterThan(0);

    // Nothing changed: the syncs that run every 30 s have nothing to hand over.
    await act(() => sync.getState().syncNow());
    await act(() => sync.getState().syncNow());
    await act(() => new Promise((settle) => setTimeout(settle, 1200)));
    expect(handed.length).toBe(before);
  });
});

/** The page's service worker, as far as the app listens to it: its messages. */
function fakeServiceWorker() {
  const listeners: ((event: MessageEvent) => void)[] = [];
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') listeners.push(listener);
      },
      removeEventListener: () => undefined,
    },
  });
  return {
    press(data: { action: 'dismiss' | 'snooze'; taskId: string; first: number }) {
      const event = new MessageEvent('message', { data: { type: 'pecklist-reminder', ...data } });
      act(() => listeners.forEach((listener) => listener(event)));
    },
  };
}

async function onServer(prepare: (backend: FakeBackend) => void = () => undefined) {
  const backend = new FakeBackend();
  backend.addAccount('ben', 'correct horse battery');
  prepare(backend);
  const transport = backend.device();
  transport.session = 'ben';
  const store = testStore();
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await renderApp('/inbox', store, sync);
  await waitFor(() => expect(sync.getState().phase).toBe('ready'));
  return { backend, transport, store, sync };
}

describe('snoozing a reminder (audit B3)', () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('on a server is mine alone: the server keeps it, the task stays, and it fires here', async () => {
    const worker = fakeServiceWorker();
    const notifier = fakeNotifier();
    setNotifier(notifier);
    const { backend, store, sync } = await onServer();
    const id = addTask(store, 'Take the pills', inMinutes(120), [{ before: 0 }]);
    await act(() => sync.getState().syncNow());
    const reminders = () =>
      store.getState().workspace!.entities.tasks.find((task) => task.id === id)!.reminders;
    const before = reminders();
    // The server's clock is ten minutes behind, so the snooze is due now and fires at once.
    backend.now = () => Date.now() - 10 * 60_000;
    const first = Date.now() - 60_000;
    worker.press({ action: 'snooze', taskId: id, first });
    await waitFor(() =>
      expect(backend.reminderPresses).toEqual([
        { taskId: id, first, action: 'snooze', username: 'ben' },
      ]),
    );
    const at = backend.snoozes.get('ben')![0]!.at;
    await waitFor(() =>
      expect(notifier.shown.map((each) => [each.title, each.tag])).toEqual([
        ['Take the pills', `${id}@${at}`],
      ]),
    );
    expect(reminders()).toEqual(before);
    expect(await screen.findByText('Reminder snoozed 10 minutes')).toBeInTheDocument();

    // Dismiss is sent as itself and snoozes nothing.
    worker.press({ action: 'dismiss', taskId: id, first });
    await waitFor(() => expect(backend.reminderPresses.at(-1)?.action).toBe('dismiss'));
    expect(backend.snoozes.get('ben')).toHaveLength(1);
  });

  it('missed by the server still comes back here, and the server hears it after a sync', async () => {
    const worker = fakeServiceWorker();
    const notifier = fakeNotifier();
    setNotifier(notifier);
    const { backend, store, sync } = await onServer();
    const id = addTask(store, 'Take the pills', inMinutes(120), [{ before: 0 }]);
    await act(() => sync.getState().syncNow());
    // Offline, or the server restarting.
    backend.failReminderPresses = true;
    const first = Date.now() - 60_000;
    const pressed = Date.now();
    worker.press({ action: 'snooze', taskId: id, first });
    expect(await screen.findByText('Reminder snoozed 10 minutes')).toBeInTheDocument();
    const at = Math.floor(pressed / 60_000) * 60_000 + 10 * 60_000;
    expect(backend.reminderPresses).toEqual([]);
    expect(notifier.shown).toEqual([]);

    // Ten minutes on (the page looks again on any change): it comes back on this device.
    const real = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => real() + 10 * 60_000 + 1_000);
    addTask(store, 'Unrelated', inMinutes(600));
    await waitFor(() =>
      expect(notifier.shown.map((each) => [each.title, each.tag])).toEqual([
        ['Take the pills', `${id}@${at}`],
      ]),
    );

    // The server is back: told after the next sync. Its time has passed, so only the repeats stop.
    backend.failReminderPresses = false;
    await act(() => sync.getState().syncNow());
    await waitFor(() =>
      expect(backend.reminderPresses).toEqual([
        { taskId: id, first, action: 'dismiss', username: 'ben' },
      ]),
    );
    expect(backend.snoozes.get('ben') ?? []).toEqual([]);
  });

  it('missed by the server is told again with the minutes left, so it comes back on time', async () => {
    const worker = fakeServiceWorker();
    setNotifier(fakeNotifier());
    const { backend, transport, store, sync } = await onServer();
    const id = addTask(store, 'Take the pills', inMinutes(120), [{ before: 0 }]);
    await act(() => sync.getState().syncNow());
    backend.failReminderPresses = true;
    const first = Date.now() - 60_000;
    const pressed = Date.now();
    worker.press({ action: 'snooze', taskId: id, first });
    await screen.findByText('Reminder snoozed 10 minutes');
    const at = Math.floor(pressed / 60_000) * 60_000 + 10 * 60_000;
    // A sync that does not get through tells nothing.
    transport.offline = true;
    await act(() => sync.getState().syncNow());
    expect(backend.reminderPresses).toEqual([]);

    transport.offline = false;
    backend.failReminderPresses = false;
    await act(() => sync.getState().syncNow());
    await waitFor(() => expect(backend.snoozes.get('ben')).toEqual([{ taskId: id, at }]));
    expect(backend.reminderPresses).toHaveLength(1);
    expect(backend.reminderPresses[0]).toMatchObject({ taskId: id, first, action: 'snooze' });
    // Told once: the next sync sends nothing more.
    await act(() => sync.getState().syncNow());
    expect(backend.reminderPresses).toHaveLength(1);
  });

  it('with no server adds a reminder to the task, as before', async () => {
    const worker = fakeServiceWorker();
    setNotifier(fakeNotifier());
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('no server'))),
    );
    const store = testStore();
    await renderApp('/inbox', store);
    const id = addTask(store, 'Take the pills', inMinutes(120), [{ before: 0 }]);
    // Taken before the press: the app reads the clock after it, so a minute may turn in between.
    const soon = [inMinutes(10), inMinutes(11)];
    worker.press({ action: 'snooze', taskId: id, first: Date.now() - 60_000 });
    await waitFor(() => {
      const reminders = store
        .getState()
        .workspace!.entities.tasks.find((task) => task.id === id)!.reminders;
      expect(reminders).toEqual([{ before: 0 }, { at: expect.any(String) }]);
      expect(soon).toContain((reminders![1] as { at: string }).at);
    });
  });

  it('in the Android app go to the system with the reminders ahead, asked for before each hand-over', async () => {
    const handed: ScheduledNotification[][] = [];
    setNotifier({
      ...fakeNotifier(),
      scheduleAhead: (notifications: ScheduledNotification[]) => {
        handed.push(notifications);
        return Promise.resolve();
      },
    });
    const { backend, store, sync } = await onServer();
    const id = addTask(store, 'Call mum', inMinutes(120), [{ before: 0 }]);
    await act(() => sync.getState().syncNow());
    await waitFor(() => expect(handed.at(-1)?.map((each) => each.title)).toEqual(['Call mum']), {
      timeout: 3000,
    });
    // Snoozed on the phone a moment ago: the server has it, this page has not synced since.
    const snoozedAt = Math.floor(Date.now() / 60_000) * 60_000 + 30 * 60_000;
    backend.snoozes.set('ben', [{ taskId: id, at: snoozedAt }]);
    addTask(store, 'Unrelated', inMinutes(300));
    await waitFor(
      () =>
        expect(handed.at(-1)?.map((each) => [each.title, each.at])).toContainEqual([
          'Call mum',
          snoozedAt,
        ]),
      { timeout: 3000 },
    );
  });

  it('count as changed when only the occurrence is new (the next one snoozed to the same minute)', () => {
    const before = [{ taskId: 'T1', at: 1_000, occurrence: '2026-10-26T15:30Z' }];
    expect(sameSnoozes(before, [{ ...before[0]! }])).toBe(true);
    expect(sameSnoozes(before, [{ ...before[0]!, occurrence: '2026-10-27T15:30Z' }])).toBe(false);
    // From an older server, absent and null are the same.
    expect(
      sameSnoozes([{ taskId: 'T1', at: 1_000 }], [{ taskId: 'T1', at: 1_000, occurrence: null }]),
    ).toBe(true);
  });

  it('in the Android app are added, taking nothing off, while the list was never had', async () => {
    const handed: { titles: string[]; keep: boolean }[] = [];
    setNotifier({
      ...fakeNotifier(),
      scheduleAhead: (notifications: ScheduledNotification[], options?: { keep?: boolean }) => {
        handed.push({ titles: notifications.map((each) => each.title), keep: !!options?.keep });
        return Promise.resolve();
      },
    });
    // The server not answering for snoozes since the page opened (0.13.0-rc.2: a task synced into
    // the open app got no alarm until a reload): a whole list would take the phone's own away.
    const { backend, store, sync } = await onServer((it) => {
      it.failSnoozes = true;
    });
    addTask(store, 'Call mum', inMinutes(120), [{ before: 0 }]);
    await act(() => sync.getState().syncNow());
    await waitFor(() => expect(handed.at(-1)).toEqual({ titles: ['Call mum'], keep: true }), {
      timeout: 3000,
    });
    expect(handed.every((each) => each.keep)).toBe(true);

    // Once it answers, the whole list again: asked again on its own (after 5 s), not at a sync.
    backend.failSnoozes = false;
    await waitFor(() => expect(handed.at(-1)).toEqual({ titles: ['Call mum'], keep: false }), {
      timeout: 9000,
    });
  }, 90_000);
});
