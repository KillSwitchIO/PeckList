import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// The service worker's notification script (public/sw-notifications.js), run as the worker would.
function worker(
  options: {
    /** The worker's `Notification` (none: a browser that has no buttons to offer) */
    notification?: { maxActions?: number };
    /** The app's open windows */
    windows?: unknown[];
    /** The server never answers */
    serverHangs?: boolean;
  } = {},
) {
  const listeners = new Map<string, (event: unknown) => void>();
  const openWindow = vi.fn<(url: string) => Promise<null>>(() => Promise.resolve(null));
  const self = {
    location: { origin: 'https://tasks.example.com' },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    clients: { matchAll: () => Promise.resolve(options.windows ?? []), openWindow },
    registration: { showNotification: vi.fn() },
    ...(options.notification ? { Notification: options.notification } : {}),
  };
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    options.serverHangs
      ? new Promise<Response>(() => undefined)
      : Promise.resolve(new Response(null, { status: 204 })),
  );
  const source = readFileSync('public/sw-notifications.js', 'utf8');
  // This origin's Cache Storage: what the worker keeps for an acting button.
  const kept = new Map<string, string>();
  const caches = {
    open: (name: string) =>
      Promise.resolve({
        put: async (key: string, response: Response) => {
          kept.set(`${name} ${key}`, await response.text());
        },
      }),
  };
  runInNewContext(source, { self, URL, fetch, caches, crypto, btoa, Response, Date });
  /**
   * Click a notification whose data (or pressed button) points at `url`; where it opens. `buttons`
   * stands in for the push's own buttons.
   */
  const click = async (
    url: unknown,
    action = '',
    buttons: { action: string; url: unknown; taskId?: string }[] = [{ action: 'open', url }],
    tag = '',
  ) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('notificationclick')!({
      action,
      notification: {
        close: () => undefined,
        data: { url, actions: buttons },
        tag,
      },
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
    return openWindow.mock.calls.at(-1)?.[0];
  };
  /** Click the body of a reminder (no button) with this tag; `sticky` for a constant one. */
  const clickReminder = async (tag: string, sticky: boolean) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('notificationclick')!({
      action: '',
      notification: {
        close: () => undefined,
        data: { url: '/today?task=T1', ...(sticky ? { sticky: true } : {}) },
        tag,
      },
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
  };
  /** A push arriving with this payload. */
  const push = async (payload: unknown) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('push')!({
      data: { json: () => payload, text: () => JSON.stringify(payload) },
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
  };
  return { click, clickReminder, push, kept, fetch, openWindow, self, listeners };
}

/** An open window of the app, on another page. */
function appWindow() {
  const win = {
    url: 'https://tasks.example.com/inbox',
    postMessage: vi.fn(),
    navigate: vi.fn((url: string) => Promise.resolve({ url })),
    focus: (): Promise<unknown> => Promise.resolve(win),
  };
  return win;
}

describe("a constant reminder's click where its Dismiss is not shown (QA's drill 2026-11-20)", () => {
  const dismiss = {
    type: 'pecklist-reminder',
    action: 'dismiss',
    taskId: 'T1',
    first: 1_700_000_000_000,
  };

  it('opens the task and counts as Dismiss: Chrome (room for two), Firefox (none), no Notification', async () => {
    for (const notification of [{ maxActions: 2 }, {}, undefined]) {
      const win = appWindow();
      const { clickReminder, fetch } = worker({
        windows: [win],
        ...(notification ? { notification } : {}),
      });
      await clickReminder('T1@1700000000000', true);
      expect(win.postMessage).toHaveBeenCalledWith(dismiss);
      // The server too: the window is about to go to the task, and may not live to tell it.
      expect(fetch).toHaveBeenCalledWith(
        '/api/reminders/act',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
        taskId: 'T1',
        first: 1_700_000_000_000,
        action: 'dismiss',
      });
      expect(win.navigate).toHaveBeenCalledWith('https://tasks.example.com/today?task=T1');
      expect(win.postMessage.mock.invocationCallOrder[0]!).toBeLessThan(
        win.navigate.mock.invocationCallOrder[0]!,
      );
    }
  });

  it("opens the task without waiting for the server's answer (a click may open for ~10 s)", async () => {
    const win = appWindow();
    const { listeners, fetch } = worker({ windows: [win], serverHangs: true });
    listeners.get('notificationclick')!({
      action: '',
      notification: {
        close: () => undefined,
        data: { url: '/today?task=T1', sticky: true },
        tag: 'T1@1',
      },
      waitUntil: () => undefined,
    });
    await vi.waitFor(() => expect(win.navigate).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(win.postMessage.mock.invocationCallOrder[0]!).toBeLessThan(
      win.navigate.mock.invocationCallOrder[0]!,
    );
  });

  it('with no window open, tells the server and opens one on the task', async () => {
    const { clickReminder, fetch, openWindow } = worker();
    await clickReminder('T1@1700000000000', true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith('https://tasks.example.com/today?task=T1');
  });

  it('leaves it alone where all three buttons fit, and for a reminder that is not constant', async () => {
    const win = appWindow();
    const roomy = worker({ windows: [win], notification: { maxActions: 3 } });
    await roomy.clickReminder('T1@1700000000000', true);
    const plain = worker({ windows: [win] });
    await plain.clickReminder('T1@1700000000000', false);
    expect(win.postMessage).not.toHaveBeenCalled();
    expect(roomy.fetch).not.toHaveBeenCalled();
    expect(plain.fetch).not.toHaveBeenCalled();
    expect(win.navigate).toHaveBeenCalledTimes(2);
  });

  it("a constant reminder's push says so in its data, for the click to read", async () => {
    const { push, self } = worker();
    await push({ title: 'Dentist', url: '/today?task=T1', tag: 'T1@1700000000000', sticky: true });
    await push({ title: 'Mow', url: '/today?task=T2', tag: 'T2@1700000000000' });
    const shown = self.registration.showNotification.mock.calls as unknown as [
      string,
      { data: Record<string, unknown> },
    ][];
    expect(shown[0]![1].data).toMatchObject({ sticky: true });
    expect(shown[1]![1].data).not.toHaveProperty('sticky');
  });
});

describe("a reminder's Complete (Ben, 2026-11-20)", () => {
  const complete = { action: 'complete', title: 'Complete', url: '/today', taskId: 'T1' };

  it('is handed to the page under a one-time name, as a thumbs up, never as a flag', async () => {
    const { click, kept, fetch } = worker();
    const opened = await click('/today?task=T1', 'complete', [complete], 'T1@1700000000000');
    const address = new URL(opened!);
    const name = address.searchParams.get('act')!;
    expect(name).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(address.pathname).toBe('/today');
    expect([...address.searchParams.keys()]).toEqual(['act']);
    // With the occurrence it is for, from the tag: a notice left up never completes a later one.
    expect(JSON.parse(kept.get(`pecklist-actions /act/${name}`)!)).toMatchObject({
      kind: 'complete',
      taskId: 'T1',
      first: 1_700_000_000_000,
    });
    // The page does it (a repeating task moves on there); the worker tells no server itself.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a reminder push shows it first; a constant one's Snooze and Dismiss come after", async () => {
    const { push, self } = worker();
    const actions = [complete];
    await push({ title: 'Mow', url: '/today?task=T1', tag: 'T1@1', actions });
    await push({ title: 'Water', url: '/today?task=T1', tag: 'T1@2', sticky: true, actions });
    const shown = self.registration.showNotification.mock.calls as unknown as [
      string,
      { actions: { action: string }[]; data: { actions: unknown[] } },
    ][];
    expect(shown[0]![1].actions.map((each) => each.action)).toEqual(['complete']);
    expect(shown[1]![1].actions.map((each) => each.action)).toEqual([
      'complete',
      'snooze',
      'dismiss',
    ]);
    // The task it names rides in the data, for the click.
    expect(shown[1]![1].data.actions).toEqual(actions);
  });
});

describe("the service worker's acting buttons (security review 2026-11-19)", () => {
  it('keeps a thumbs up or dibs for the page under a one-time name, never as a flag in the address', async () => {
    const { click, kept } = worker();
    const url = '/today?task=T1&comment=C1';
    const opened = await click(url, 'like', [
      { action: 'reply', url },
      { action: 'like', url, taskId: 'T1' },
    ]);
    const address = new URL(opened!);
    const name = address.searchParams.get('act')!;
    // 128 random bits, base64url.
    expect(name).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(address.searchParams.get('task')).toBe('T1');
    expect(address.searchParams.has('like')).toBe(false);
    const entry = JSON.parse(kept.get(`pecklist-actions /act/${name}`)!);
    expect(entry).toMatchObject({ kind: 'like', taskId: 'T1' });
    expect(Math.abs(entry.at - Date.now())).toBeLessThan(5000);

    // Each press its own name.
    const again = await click(url, 'like', [{ action: 'like', url, taskId: 'T1' }]);
    expect(new URL(again!).searchParams.get('act')).not.toBe(name);
  });

  it('keeps nothing for a button that only opens, or one with no task', async () => {
    const { click, kept } = worker();
    const url = '/today?task=T1';
    expect(await click(url, 'open', [{ action: 'open', url, taskId: 'T1' }])).toBe(
      'https://tasks.example.com/today?task=T1',
    );
    expect(await click(url, 'dibs', [{ action: 'dibs', url }])).toBe(
      'https://tasks.example.com/today?task=T1',
    );
    expect(kept.size).toBe(0);
  });
});

describe("the service worker's notification clicks (audit W2)", () => {
  it('opens paths on this server, and nothing else', async () => {
    const { click } = worker();
    expect(await click('/task/01ABC')).toBe('https://tasks.example.com/task/01ABC');
    expect(await click('/task/01ABC', 'open')).toBe('https://tasks.example.com/task/01ABC');
    for (const elsewhere of [
      'https://evil.example/phish',
      '//evil.example/phish',
      '/\\evil.example/phish',
      'javascript:alert(1)',
      42,
      undefined,
    ]) {
      expect(await click(elsewhere)).toBe('https://tasks.example.com/today');
    }
  });
});
