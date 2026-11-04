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
  runInNewContext(source, { self, URL, fetch: vi.fn() });
  /** Click a notification whose data (or pressed button) points at `url`; where it opens. */
  const click = async (url: unknown, action = '') => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('notificationclick')!({
      action,
      notification: {
        close: () => undefined,
        data: { url, actions: [{ action: 'open', url }] },
        tag: '',
      },
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
    return openWindow.mock.calls.at(-1)?.[0];
  };
  return { click };
}

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
