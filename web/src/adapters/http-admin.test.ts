import { describe, expect, it, vi } from 'vitest';
import { SyncFailure } from '../ports/sync.ts';
import { createHttpAdmin } from './http-admin.ts';

type Reply = { status: number; body?: unknown };

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetcher = vi.fn((url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    });
    const reply = replies.shift() ?? { status: 500 };
    return Promise.resolve(
      new Response(
        reply.status === 204 || reply.body === undefined ? null : JSON.stringify(reply.body),
        {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe('HTTP admin', () => {
  it('turns refusals the admin can act on into reasons', async () => {
    const { fetcher } = fakeFetch(
      { status: 409, body: { error: 'last_super_admin' } },
      { status: 409, body: { error: 'self' } },
      { status: 409, body: { error: 'username_taken' } },
      { status: 400, body: { error: 'invalid_username' } },
      { status: 403 },
      { status: 400, body: { error: 'too_short' } },
    );
    const admin = createHttpAdmin('', fetcher);
    expect(await admin.setRole('U1', 'user')).toEqual({ ok: false, reason: 'last-super-admin' });
    expect(await admin.setDisabled('U1', true)).toEqual({ ok: false, reason: 'self' });
    expect(await admin.addUser('sam', 'user')).toEqual({ ok: false, reason: 'taken' });
    expect(await admin.addUser('Sam Q', 'user')).toEqual({ ok: false, reason: 'invalid' });
    // A plain 403: the caller may not touch that account.
    expect(await admin.resetPassword('U9')).toEqual({ ok: false, reason: 'admins-only' });
    expect(await admin.updateGroup('G1', { name: 'x' })).toEqual({
      ok: false,
      reason: 'too-short',
    });
  });

  it('reads a server without PUBLIC_URL as a reason, for sign-in links and invites (S16)', async () => {
    const needs = {
      status: 409,
      body: {
        error: 'public_url_required',
        message: 'Set PUBLIC_URL to this server address first',
      },
    };
    const { fetcher } = fakeFetch(needs, needs);
    const admin = createHttpAdmin('', fetcher);
    expect(await admin.loginLink('U1')).toEqual({ ok: false, reason: 'needs-public-url' });
    expect(await admin.createInvite({ days: 7, uses: 1, note: '' })).toEqual({
      ok: false,
      reason: 'needs-public-url',
    });
  });

  it('emails reset links and manages passkeys and invites by email (PL-122, PL-123)', async () => {
    const passkey = {
      id: 'k1',
      name: 'Pixel',
      createdAt: '2026-11-04T09:00:00Z',
      lastUsedAt: null,
      synced: true,
    };
    const { fetcher, calls } = fakeFetch(
      { status: 204 },
      { status: 409, body: { error: 'no_confirmed_email' } },
      { status: 409, body: { error: 'mail_not_set_up' } },
      { status: 502, body: { error: 'mail_failed' } },
      { status: 200, body: [passkey] },
      { status: 204 },
      { status: 200, body: { url: 'https://x/join/t', invite: { id: 'I1' }, sent: true } },
    );
    const admin = createHttpAdmin('', fetcher);
    expect(await admin.sendResetLink('U1')).toEqual({ ok: true, value: undefined });
    expect(await admin.sendResetLink('U1')).toEqual({ ok: false, reason: 'no-email' });
    expect(await admin.sendResetLink('U1')).toEqual({ ok: false, reason: 'mail-off' });
    expect(await admin.sendResetLink('U1')).toEqual({ ok: false, reason: 'mail-failed' });
    expect(await admin.passkeys('U1')).toEqual([passkey]);
    expect(await admin.removePasskey('U1', 'k1')).toEqual({ ok: true, value: undefined });
    expect(calls[5]?.url).toBe('/api/admin/users/U1/passkeys/k1');
    const made = await admin.createInvite({
      days: 7,
      uses: 1,
      note: '',
      sendTo: 'friend@example.com',
    });
    expect(made.ok && made.value.sent).toBe(true);
    expect((calls[6]?.body as { sendTo?: string }).sendTo).toBe('friend@example.com');
  });

  it('answers with what the server made', async () => {
    const { fetcher, calls } = fakeFetch(
      { status: 201, body: { id: 'U3', username: 'zoe', role: 'user', password: 'secret' } },
      { status: 200, body: { password: 'reset' } },
      { status: 200, body: { unbound: 1, stranded: ['kim'] } },
    );
    const admin = createHttpAdmin('/base', fetcher);
    expect(await admin.addUser('zoe', 'admin')).toEqual({
      ok: true,
      value: { id: 'U3', password: 'secret' },
    });
    expect(calls[0]).toEqual({
      url: '/base/api/admin/users',
      method: 'POST',
      body: { username: 'zoe', role: 'admin' },
    });
    expect(await admin.resetPassword('U3')).toEqual({ ok: true, value: 'reset' });
    // Provider subjects can hold any character.
    expect(await admin.unlink('U3', 'auth0', 'auth0|42/x')).toEqual({
      ok: true,
      value: { stranded: true },
    });
    expect(calls[2]?.url).toBe('/base/api/admin/users/U3/identities/auth0/auth0%7C42%2Fx');
    expect(calls[2]?.method).toBe('DELETE');
  });

  it('an Unbind all refused because another admin is linked says so', async () => {
    const { fetcher } = fakeFetch({ status: 403, body: { error: 'admin_linked' } });
    const admin = createHttpAdmin('', fetcher);
    expect(await admin.unbindAll('auth0')).toEqual({ ok: false, reason: 'admin-linked' });
  });

  it('a lost session or a broken server is a failure, not a refusal', async () => {
    const { fetcher } = fakeFetch(
      { status: 401 },
      { status: 500 },
      { status: 409, body: { error: 'something_new' } },
    );
    const admin = createHttpAdmin('', fetcher);
    await expect(admin.users()).rejects.toMatchObject({ kind: 'signed-out' });
    await expect(admin.groups()).rejects.toBeInstanceOf(SyncFailure);
    await expect(admin.setRole('U1', 'admin')).rejects.toMatchObject({ kind: 'server' });
  });

  it('a settings change the server will not take comes back with its reason', async () => {
    const view = { settings: [], pendingRestart: true, problem: null };
    const { fetcher, calls } = fakeFetch(
      {
        status: 400,
        body: {
          error: 'invalid',
          message: "SNAPSHOT_KEEP: '0' is not a whole number of at least 1",
        },
      },
      { status: 409, body: { error: 'locked', message: 'DB_PATH is set outside this page' } },
      { status: 200, body: view },
    );
    const admin = createHttpAdmin('', fetcher);
    expect(await admin.saveSettings({ SNAPSHOT_KEEP: '0' })).toEqual({
      ok: false,
      message: "SNAPSHOT_KEEP: '0' is not a whole number of at least 1",
    });
    expect(await admin.saveSettings({ DB_PATH: '/x' })).toEqual({
      ok: false,
      message: 'DB_PATH is set outside this page',
    });
    expect(await admin.saveSettings({ REGISTRATION: 'open' })).toEqual({ ok: true, value: view });
    expect(calls[2]).toEqual({
      url: '/api/admin/settings',
      method: 'PUT',
      body: { values: { REGISTRATION: 'open' } },
    });
  });

  it('reads how the log outputs are doing and where the debug dump downloads from', async () => {
    const view = { level: 'information', overrides: {}, outputs: [] };
    const { fetcher, calls } = fakeFetch({ status: 200, body: view });
    const admin = createHttpAdmin('https://pl.home', fetcher);
    expect(await admin.logging()).toEqual(view);
    expect(calls[0]?.url).toBe('https://pl.home/api/admin/logging');
    expect(admin.debugDumpUrl()).toBe('https://pl.home/api/admin/debug-dump');
  });

  it('asks for the access and event log with only the filters that are set', async () => {
    const { fetcher, calls } = fakeFetch({ status: 200, body: { entries: [], more: false } });
    const admin = createHttpAdmin('', fetcher);
    expect(await admin.audit({ kind: 'event', outcome: 'failed', text: '', limit: 50 })).toEqual({
      entries: [],
      more: false,
    });
    expect(calls[0]?.url).toBe('/api/admin/audit?kind=event&outcome=failed&limit=50');
    expect(admin.auditCsvUrl({ kind: 'access', user: 'sam smith' })).toBe(
      '/api/admin/audit.csv?kind=access&user=sam+smith',
    );
  });

  it('restores from a file or a backup on the server, saying why one will not do', async () => {
    const forms: FormData[] = [];
    const replies = [
      new Response(
        JSON.stringify({ username: 'sam', created: true, restored: 3, removed: 0, dropped: 1 }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
      new Response(JSON.stringify({ error: 'bad_backup', message: 'not a PeckList backup' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(null, { status: 202 }),
    ];
    const fetcher = ((_: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return Promise.resolve(replies.shift()!);
    }) as unknown as typeof fetch;
    const admin = createHttpAdmin('', fetcher);
    const file = new File(['{}'], 'sam.json', { type: 'application/json' });
    expect(await admin.restoreUser({ file })).toEqual({
      ok: true,
      value: { username: 'sam', created: true, restored: 3, removed: 0, dropped: 1 },
    });
    expect((forms[0]!.get('file') as File).name).toBe('sam.json');
    expect(await admin.restoreUser({ backup: 'pecklist-1.json' }, 'kim')).toEqual({
      ok: false,
      message: 'not a PeckList backup',
    });
    expect([forms[1]!.get('backup'), forms[1]!.get('username')]).toEqual([
      'pecklist-1.json',
      'kim',
    ]);
    expect(await admin.restoreServer({ backup: 'pecklist-1.json' })).toEqual({ ok: true });
    expect(admin.userExportUrl('U 1')).toBe('/api/admin/users/U%201/export');
  });

  it('is offline when nothing answers', async () => {
    const admin = createHttpAdmin('', () => Promise.reject(new Error('down')));
    await expect(admin.providers()).rejects.toMatchObject({ kind: 'offline' });
  });
});
