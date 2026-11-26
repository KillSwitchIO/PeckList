import { describe, expect, it, vi } from 'vitest';
import { SyncFailure } from '../ports/sync.ts';
import { createHttpSync } from './http-sync.ts';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? { status: 500 };
    return Promise.resolve(
      new Response(
        reply.status === 204 || reply.body === undefined ? null : JSON.stringify(reply.body),
        {
          status: reply.status,
          headers: { 'content-type': 'application/json', ...reply.headers },
        },
      ),
    );
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

function calendars(...replies: Reply[]) {
  const fake = fakeFetch(...replies);
  return { api: createHttpSync('', fake.fetcher).calendars!, calls: fake.calls };
}

describe('the calendar routes over HTTP (PL-134)', () => {
  it('gives a refusal as the server code alone, never its message', async () => {
    const { api } = calendars({
      status: 400,
      body: { error: 'calendar_address_blocked', message: 'will not call 10.0.0.5' },
    });

    expect(
      await api.connectCalDav({
        serverUrl: 'https://cal.example.com',
        username: 'sam',
        password: 'pw',
      }),
    ).toEqual({ ok: false, code: 'calendar_address_blocked' });
  });

  it('says too many with the wait the server asked for', async () => {
    const { api } = calendars({ status: 429, headers: { 'Retry-After': '42' } });

    expect(await api.syncNow('L1')).toEqual({ ok: false, code: 'too_many', retryAfter: 42 });
  });

  it('reads a bare 404 as a calendar that is gone, and a 409 by its code', async () => {
    const { api } = calendars(
      { status: 404 },
      { status: 409, body: { error: 'calendar_recurring_read_only' } },
    );

    expect(await api.setMode('L1', { mode: 'show' })).toEqual({
      ok: false,
      code: 'calendar_not_found',
    });
    expect(await api.editEvent('E1', { title: 'Swim' })).toEqual({
      ok: false,
      code: 'calendar_recurring_read_only',
    });
  });

  it('sends a hide as the page goes with keepalive, and takes a gone event as hidden', async () => {
    const { api, calls } = calendars({ status: 404 });

    await api.hide('E 1', '2026-12-01', { keepalive: true });

    expect(calls[0]!.url).toBe('/api/calendars/events/E%201/hide');
    expect(calls[0]!.init.keepalive).toBe(true);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ occurrence: '2026-12-01' });
  });

  it('asks for events by day range and fails as offline behind a gateway', async () => {
    const { api, calls } = calendars({ status: 200, body: { events: [] } }, { status: 502 });

    expect(await api.events('2026-12-01', '2026-12-31')).toEqual([]);
    expect(calls[0]!.url).toBe('/api/calendars/events?from=2026-12-01&to=2026-12-31');
    await expect(api.list()).rejects.toMatchObject({
      kind: 'offline',
    } satisfies Partial<SyncFailure>);
  });

  it('connects CalDAV as the caldav kind', async () => {
    const { api, calls } = calendars({ status: 201, body: { id: 'A1', calendars: [] } });

    await api.connectCalDav({
      serverUrl: 'https://cal.example.com',
      username: 'sam',
      password: 'pw',
    });

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      provider: 'caldav',
      serverUrl: 'https://cal.example.com',
      username: 'sam',
      password: 'pw',
    });
  });
});
