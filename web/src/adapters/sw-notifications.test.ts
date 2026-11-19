import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// The service worker's notification script (public/sw-notifications.js), run as the worker would.
function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const openWindow = vi.fn<(url: string) => Promise<null>>(() => Promise.resolve(null));
  const self = {
    location: { origin: 'https://tasks.example.com' },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    clients: { matchAll: () => Promise.resolve([]), openWindow },
    registration: { showNotification: vi.fn() },
  };
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
  runInNewContext(source, { self, URL, fetch: vi.fn(), caches, crypto, btoa, Response, Date });
  /**
   * Click a notification whose data (or pressed button) points at `url`; where it opens. `buttons`
   * stands in for the push's own buttons.
   */
  const click = async (
    url: unknown,
    action = '',
    buttons: { action: string; url: unknown; taskId?: string }[] = [{ action: 'open', url }],
  ) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('notificationclick')!({
      action,
      notification: {
        close: () => undefined,
        data: { url, actions: buttons },
        tag: '',
      },
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
    return openWindow.mock.calls.at(-1)?.[0];
  };
  return { click, kept };
}

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
