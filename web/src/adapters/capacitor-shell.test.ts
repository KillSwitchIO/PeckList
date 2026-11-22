import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  heldPresses,
  nativeStoreCalls,
  phoneChannels,
  shellInfo,
  storePage,
  storeWhole,
  WHOLE_STORE_HEADER,
} from './capacitor-shell.ts';

const answer = (body: unknown, status = 200, header: string | null = '1') =>
  new Response(JSON.stringify(body), {
    status,
    headers: header === null ? {} : { [WHOLE_STORE_HEADER]: header },
  });

describe('storeWhole', () => {
  it('takes the whole store the shell answered with', async () => {
    const header = { doc: { schemaVersion: 1 }, order: { tasks: ['1'] } };
    expect(await storeWhole(answer({ header, rows: [['tasks/1', { id: '1' }]] }))).toEqual({
      header,
      rows: [['tasks/1', { id: '1' }]],
    });
    expect(await storeWhole(answer({ header: null, rows: [] }))).toEqual({
      header: null,
      rows: [],
    });
  });

  it('reads pages instead when the answer is not the shell’s (the page, a server, a refusal)', async () => {
    expect(await storeWhole(answer({ header: null, rows: [] }, 200, null))).toBeNull();
    expect(await storeWhole(answer('<!doctype html>', 200, null))).toBeNull();
    expect(await storeWhole(answer(null, 403))).toBeNull();
    expect(await storeWhole(answer(null, 404, null))).toBeNull();
  });

  it('refuses an answer from the shell it cannot read, rather than read it as empty', async () => {
    await expect(storeWhole(answer({ header: 'text', rows: [] }))).rejects.toThrow();
    await expect(storeWhole(answer({ header: null, rows: [['tasks/1', '{}']] }))).rejects.toThrow();
    await expect(storeWhole(answer({ header: null }))).rejects.toThrow();
    await expect(storeWhole(answer(null))).rejects.toThrow();
  });
});

describe('the whole read', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The store calls over a shell whose info() answers `infos` in turn (an Error rejects). */
  const calls = (...infos: (number | Error)[]) => {
    const info = vi.fn(() => {
      const next = infos.shift() ?? 18;
      return next instanceof Error ? Promise.reject(next) : Promise.resolve({ api: next });
    });
    const plugin = { info } as unknown as Parameters<typeof nativeStoreCalls>[0];
    return { store: nativeStoreCalls(plugin), info };
  };

  it('asks for it on a shell that has it, and not on an older one', async () => {
    const fetch = vi.fn(() => Promise.resolve(answer({ header: null, rows: [] })));
    vi.stubGlobal('fetch', fetch);
    expect(await calls(18).store.whole()).toEqual({ header: null, rows: [] });
    expect(fetch).toHaveBeenCalledOnce();
    expect(await calls(17).store.whole()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reads pages, not a failed load, when the fetch fails (offline behind a service worker)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await calls(18).store.whole()).toBeNull();
  });

  it('reads pages when info() fails, and asks again on the next load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(answer({ header: null, rows: [] }))),
    );
    const { store, info } = calls(new Error('bridge not ready'), 18);
    expect(await store.whole()).toBeNull();
    expect(await store.whole()).toEqual({ header: null, rows: [] });
    expect(info).toHaveBeenCalledTimes(2);
  });

  it('still fails on an answer from the shell it cannot read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(answer({ header: null }))),
    );
    await expect(calls(18).store.whole()).rejects.toThrow();
  });
});

describe('storePage', () => {
  it('takes a page the shell answered with, and refuses anything else rather than read it as empty', () => {
    expect(storePage({ header: '{"doc":{}}', rows: [['tasks/1', '{}']], next: 'tasks/1' })).toEqual(
      { header: '{"doc":{}}', rows: [['tasks/1', '{}']], next: 'tasks/1' },
    );
    expect(storePage({ header: null, rows: [], next: null })).toEqual({
      header: null,
      rows: [],
      next: null,
    });
    expect(() => storePage({ header: 3, rows: [] })).toThrow();
    expect(() => storePage({ header: null, rows: [['tasks/1', 2]] })).toThrow();
    expect(() => storePage({ header: null })).toThrow();
    expect(() => storePage(null)).toThrow();
  });
});

describe('heldPresses', () => {
  it('keeps the presses the shell answered with, and leaves out any it got wrong', () => {
    const good = { action: 'complete', taskId: 'T1', minutes: 10, at: 1 };
    expect(
      heldPresses({
        presses: [good, { ...good, action: 'open' }, { ...good, taskId: 3 }, null, 'x'],
      }),
    ).toEqual([good]);
    expect(heldPresses({})).toEqual([]);
  });
});

describe('phoneChannels', () => {
  it('keeps the kinds the shell knows, and only true or false', () => {
    expect(
      phoneChannels({
        channels: { reminders: true, constant: false, mystery: true, shares: 'yes' } as never,
        changed: { comments: false, constant: true } as never,
      }),
    ).toEqual({ channels: { reminders: true, constant: false }, changed: { comments: false } });
    expect(phoneChannels(null)).toEqual({ channels: {}, changed: {} });
  });
});

describe('shellInfo', () => {
  const answer = { api: 15, server: 'https://tasks.example.com', version: '0.15.0' };

  it('passes on the app that installed it, or null when Android does not say', () => {
    expect(shellInfo({ ...answer, installer: 'org.fdroid.fdroid' }).installer).toBe(
      'org.fdroid.fdroid',
    );
    expect(shellInfo({ ...answer, installer: null }).installer).toBeNull();
    expect(shellInfo({ ...answer, installer: 7 as never }).installer).toBeNull();
  });

  it('passes on the app that asked for the install the same way', () => {
    expect(
      shellInfo({ ...answer, installRequestedBy: 'org.fdroid.fdroid' }).installRequestedBy,
    ).toBe('org.fdroid.fdroid');
    expect(shellInfo({ ...answer, installRequestedBy: {} as never }).installRequestedBy).toBeNull();
  });

  it('an older shell says nothing of it, and nothing is made up', () => {
    expect(shellInfo(answer)).not.toHaveProperty('installer');
    expect(shellInfo(answer)).not.toHaveProperty('installRequestedBy');
    expect(shellInfo({ ...answer, distribution: 'beta' as never })).not.toHaveProperty(
      'distribution',
    );
  });
});
