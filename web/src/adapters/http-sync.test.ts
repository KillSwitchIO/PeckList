import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncFailure } from '../ports/sync.ts';
import { createHttpSync } from './http-sync.ts';

type Reply = { status: number; body?: unknown; type?: string };

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(...replies: (Reply | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? { status: 500 };
    if (reply instanceof Error) return Promise.reject(reply);
    const body =
      reply.body === undefined
        ? ''
        : typeof reply.body === 'string'
          ? reply.body
          : JSON.stringify(reply.body);
    return Promise.resolve(
      new Response(reply.status === 204 ? null : body, {
        status: reply.status,
        headers: { 'content-type': reply.type ?? 'application/json' },
      }),
    );
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const account = {
  id: 'U1',
  username: 'ben',
  role: 'admin',
  mustChangePassword: false,
  authMode: 'local',
};

async function failure(promise: Promise<unknown>): Promise<SyncFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SyncFailure) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

afterEach(() => vi.unstubAllGlobals());

describe('HTTP sync transport', () => {
  it('tells a Punchlist server from a static host', async () => {
    const info = { name: 'punchlist', version: '0.1.0', schemaVersion: 4 };
    const { fetcher } = fakeFetch(
      { status: 200, body: info },
      { status: 404 },
      { status: 200, body: '<!doctype html>', type: 'text/html' },
      { status: 200, body: { name: 'something-else' } },
    );
    const http = createHttpSync('', fetcher);
    expect(await http.info()).toEqual(info);
    expect(await http.info()).toBeNull();
    expect(await http.info()).toBeNull();
    expect(await http.info()).toBeNull();
  });

  it('reads who is signed in', async () => {
    const { fetcher } = fakeFetch({ status: 200, body: account }, { status: 401 });
    const http = createHttpSync('', fetcher);
    expect(await http.me()).toEqual(account);
    expect(await http.me()).toBeNull();
  });

  it('turns sign-in answers into outcomes', async () => {
    const { fetcher, calls } = fakeFetch(
      { status: 200, body: account },
      { status: 401, body: { error: 'invalid' } },
      { status: 423, body: { error: 'locked', until: '2026-10-21T12:00:00Z' } },
      { status: 429 },
      { status: 403, body: { error: 'local_login_disabled' } },
    );
    const http = createHttpSync('', fetcher);
    expect(await http.login('ben', 'pw')).toEqual({ kind: 'ok', account });
    expect(await http.login('ben', 'pw')).toEqual({ kind: 'invalid' });
    expect(await http.login('ben', 'pw')).toEqual({
      kind: 'locked',
      until: '2026-10-21T12:00:00Z',
    });
    expect(await http.login('ben', 'pw')).toEqual({ kind: 'too-many' });
    expect(await http.login('ben', 'pw')).toEqual({ kind: 'disabled' });
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ username: 'ben', password: 'pw' });
    expect(calls[0]!.init.credentials).toBe('same-origin');
  });

  it('lists the identity providers with the address that starts each', async () => {
    const { fetcher, calls } = fakeFetch(
      {
        status: 200,
        body: { providers: [{ name: 'pocket', displayName: 'Pocket ID' }], localLogin: false },
      },
      { status: 200, body: '<!doctype html>', type: 'text/html' },
    );
    const http = createHttpSync('', fetcher);
    expect(await http.signInOptions?.('/lists/a b')).toEqual({
      providers: [
        {
          name: 'pocket',
          displayName: 'Pocket ID',
          url: '/auth/oidc/pocket/login?returnUrl=%2Flists%2Fa%20b',
        },
      ],
      localLogin: false,
      registration: 'closed',
    });
    expect(calls[0]?.url).toBe('/auth/providers');
    // A server from before OIDC answers with the app's page: passwords only.
    expect(await http.signInOptions?.('/')).toEqual({ providers: [], localLogin: true });
  });

  it('signs up and reads invites, turning refusals into outcomes', async () => {
    const { fetcher, calls } = fakeFetch(
      { status: 200, body: account },
      { status: 409, body: { error: 'username_taken' } },
      { status: 400, body: { error: 'invalid_username' } },
      { status: 400, body: { error: 'invite_invalid' } },
      { status: 403, body: { error: 'invite_required' } },
      { status: 429, body: {} },
      { status: 200, body: { expires: '2026-10-30T08:00:00Z' } },
      { status: 404, body: { error: 'invite_invalid' } },
    );
    const http = createHttpSync('', fetcher);
    expect((await http.signUp!('sam', 'a long enough password', 'tok')).kind).toBe('ok');
    expect(calls[0]).toMatchObject({ url: '/auth/signup', init: { method: 'POST' } });
    const outcomes = [];
    for (let each = 0; each < 5; each++) outcomes.push((await http.signUp!('sam', 'x')).kind);
    expect(outcomes).toEqual([
      'username-taken',
      'invalid-username',
      'invite-invalid',
      'closed',
      'too-many',
    ]);
    expect(await http.checkInvite!('a/b')).toEqual({ expires: '2026-10-30T08:00:00Z' });
    expect(calls.at(-1)?.url).toBe('/auth/invites/a%2Fb');
    expect(await http.checkInvite!('gone')).toBeNull();
  });

  it('turns password answers into outcomes', async () => {
    const { fetcher } = fakeFetch(
      { status: 200, body: account },
      { status: 400, body: { error: 'wrong_password' } },
      { status: 400, body: { error: 'too_short' } },
      { status: 400, body: { error: 'unchanged' } },
    );
    const http = createHttpSync('', fetcher);
    expect((await http.changePassword('a', 'b')).kind).toBe('ok');
    expect((await http.changePassword('a', 'b')).kind).toBe('wrong-password');
    expect((await http.changePassword('a', 'b')).kind).toBe('too-short');
    expect((await http.changePassword('a', 'b')).kind).toBe('unchanged');
  });

  it('gives up on a request that never answers, and reads it as offline', async () => {
    vi.useFakeTimers();
    try {
      // A fetch that only ends when it is aborted.
      const fetcher = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      const http = createHttpSync('/base', fetcher as unknown as typeof fetch);
      const pending = failure(http.sync({ schemaVersion: 4, cursor: null, changes: [] }));
      await vi.advanceTimersByTimeAsync(29_000);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      const failed = await pending;
      expect(failed.kind).toBe('offline');
      expect(failed.message).toMatch(/no answer in 30 s/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('syncs, naming the device', async () => {
    const response = { cursor: 3, changes: [], more: false, revoked: [] };
    const { fetcher, calls } = fakeFetch({ status: 200, body: response });
    const http = createHttpSync('/base', fetcher, 'dev1');
    expect(await http.sync({ schemaVersion: 4, cursor: null, changes: [] })).toEqual(response);
    expect(calls[0]!.url).toBe('/base/api/sync');
    expect(calls[0]!.init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Punchlist-Device': 'dev1',
    });
  });

  it('says why a request failed', async () => {
    const { fetcher } = fakeFetch(
      new TypeError('Failed to fetch'),
      { status: 401 },
      { status: 403, body: { error: 'password_change_required' } },
      { status: 409, body: { error: 'schema_mismatch', message: 'old', serverSchemaVersion: 5 } },
      { status: 400, body: { error: 'invalid_change', message: 'bad clock' } },
      { status: 503 },
      { status: 500, body: 'oops', type: 'text/plain' },
    );
    const http = createHttpSync('', fetcher);
    const request = { schemaVersion: 4, cursor: null, changes: [] };
    expect((await failure(http.sync(request))).kind).toBe('offline');
    expect((await failure(http.sync(request))).kind).toBe('signed-out');
    expect((await failure(http.sync(request))).kind).toBe('password-change');
    const schema = await failure(http.sync(request));
    expect(schema.kind).toBe('schema');
    expect(schema.serverSchemaVersion).toBe(5);
    const rejected = await failure(http.sync(request));
    expect([rejected.kind, rejected.message]).toEqual(['rejected', 'bad clock']);
    expect((await failure(http.sync(request))).kind).toBe('offline');
    expect((await failure(http.sync(request))).kind).toBe('server');
  });

  it('logs out, ignoring an expired session', async () => {
    const { fetcher, calls } = fakeFetch({ status: 204 }, { status: 401 });
    const http = createHttpSync('', fetcher);
    await http.logout();
    await http.logout();
    expect(calls.map((call) => call.url)).toEqual(['/auth/logout', '/auth/logout']);
  });

  it('handles friend links and lookups', async () => {
    const preview = {
      userId: 'U2',
      username: 'sam',
      displayName: 'Sam',
      handle: 'sam',
      avatarColor: '#F4B6C2',
      memberSince: '2026-10-01T08:00:00Z',
      self: false,
      friendship: null,
    };
    const { fetcher, calls } = fakeFetch(
      { status: 200, body: { code: '7QM4-K2XP', link: 'https://x/f/7QM4-K2XP' } },
      { status: 200, body: { code: 'AAAA-BBBB', link: 'https://x/f/AAAA-BBBB' } },
      { status: 200, body: preview },
      { status: 404 },
      { status: 200, body: { friendshipId: 'F1' } },
      { status: 404 },
      { status: 200, body: preview },
      { status: 404 },
    );
    const friends = createHttpSync('', fetcher).friends!;
    expect((await friends.code()).code).toBe('7QM4-K2XP');
    expect((await friends.code(true)).code).toBe('AAAA-BBBB');
    expect(calls[1]!.init.method).toBe('POST');
    expect(await friends.preview('7QM4-K2XP')).toEqual(preview);
    expect(await friends.preview('gone')).toBeNull();
    expect(await friends.accept('7QM4-K2XP')).toBe('F1');
    expect(await friends.accept('gone')).toBeNull();
    expect((await friends.lookup('sam'))?.username).toBe('sam');
    expect(await friends.lookup('nobody')).toBeNull();
    expect(calls[6]!.url).toBe('/api/users/lookup?q=sam');
  });

  it('listens for changes over Server-Sent Events', () => {
    const listeners = new Map<string, (event: MessageEvent<string>) => void>();
    const close = vi.fn();
    class FakeEventSource {
      constructor(
        readonly url: string,
        readonly options: EventSourceInit,
      ) {}
      addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
        listeners.set(type, listener);
      }
      close = close;
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onChange = vi.fn();
    const stop = createHttpSync('', fakeFetch().fetcher).events!(onChange);
    listeners.get('changed')!({ data: '{"cursor":7,"source":"dev2"}' } as MessageEvent<string>);
    listeners.get('changed')!({ data: 'not json' } as MessageEvent<string>);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ cursor: 7, source: 'dev2' });
    stop();
    expect(close).toHaveBeenCalled();
  });

  it('does without events where the browser has none', () => {
    vi.stubGlobal('EventSource', undefined);
    const stop = createHttpSync('', fakeFetch().fetcher).events!(() => undefined);
    expect(stop()).toBeUndefined();
  });
});
