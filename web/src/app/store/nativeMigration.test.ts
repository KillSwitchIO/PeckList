import { deleteDB, openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createIndexedDbStorage } from '../../adapters/indexeddb-storage.ts';
import { createNativeStorage } from '../../adapters/native-storage.ts';
import { entityClock, pendingChanges, type Acks } from '../../core/sync.ts';
import { COLLECTIONS, type WorkspaceFile } from '../../core/types.ts';
import type { NativeStoreCalls } from '../../ports/nativeShell.ts';
import { FakeNativeStore } from '../../test/fakeNativeStore.ts';
import { sampleWorkspace } from '../../test/fixtures.ts';
import {
  canonicalJson,
  deleteOlderCopy,
  FAILURES_TO_SAY,
  moveToNative,
  moveToNativeWithin,
  nativeMoveFailures,
  olderCopy,
  olderCopyKept,
} from './nativeMigration.ts';

const names = async () => (await indexedDB.databases()).map((each) => each.name).sort();

/** Every entity acknowledged, so nothing is waiting to sync. */
function allAcked(workspace: WorkspaceFile): Acks {
  const acks: Acks = {};
  for (const collection of COLLECTIONS) {
    for (const entity of workspace.entities[collection]) {
      acks[entity.id] = entityClock(entity, collection) ?? '';
    }
  }
  return acks;
}

/** What the WebView keeps: the workspace as records, the sync state and a backup. */
async function seedWebView(workspace: WorkspaceFile, acks: Acks = allAcked(workspace)) {
  const webView = createIndexedDbStorage();
  await webView.save(workspace);
  await webView.saveMeta('sync', { account: 'U1', cursor: 42, acks, epoch: 'e1' });
  await webView.saveMeta('generation', 'g7');
  await webView.backup('workspace.v20.bak.json', { schemaVersion: 20, note: 'before 21' });
  return webView;
}

const renamed = (workspace: WorkspaceFile, title: string): WorkspaceFile => {
  const [first, ...rest] = workspace.entities.tasks;
  return {
    ...workspace,
    entities: {
      ...workspace.entities,
      tasks: [
        {
          ...first!,
          title,
          _hlc: { ...first!._hlc, title: '2099-01-01T00:00:00.000Z-0000-phone' },
        },
        ...rest,
      ],
    },
  };
};

describe('moving the Android app’s data to its own storage (PL-070)', () => {
  afterEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    for (const name of await names()) if (name) await deleteDB(name);
  });

  it('moves the workspace, sync state and backups whole, then drops the web view’s copy', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const files = await openDB('pecklist-files', 1, {
      upgrade: (db) => db.createObjectStore('blobs'),
    });
    files.close();
    const device = new FakeNativeStore();

    const storage = await moveToNative(device.calls());

    expect(storage?.kind).toBe('native');
    expect(await storage!.load()).toEqual(workspace);
    expect(await storage!.loadMeta('sync')).toEqual({
      account: 'U1',
      cursor: 42,
      acks: allAcked(workspace),
      epoch: 'e1',
    });
    expect(await storage!.loadMeta('generation')).toBe('g7');
    expect(await storage!.loadBackup('workspace.v20.bak.json')).toEqual({
      schemaVersion: 20,
      note: 'before 21',
    });
    const kv = device.peek().kv;
    expect(kv.get('meta:movedFromWebView')).toBe('true');
    expect(kv.has('meta:migrating')).toBe(false);
    // Attached files stay where they are.
    expect(await names()).toEqual(['pecklist-files']);
  });

  it('moves unsynced changes with the acknowledgements they had, so nothing goes twice', async () => {
    const workspace = renamed(sampleWorkspace(), 'Changed offline');
    await seedWebView(workspace, allAcked(sampleWorkspace()));
    const device = new FakeNativeStore();
    const storage = await moveToNative(device.calls());
    const moved = (await storage!.load()) as WorkspaceFile;
    const { acks } = (await storage!.loadMeta('sync')) as { acks: Acks };
    expect(pendingChanges(moved, acks).map((change) => change.entity.id)).toEqual([
      workspace.entities.tasks[0]!.id,
    ]);
  });

  it('moves a workspace an older version kept as one text', async () => {
    const workspace = sampleWorkspace();
    const old = await openDB('pecklist', 1, { upgrade: (db) => db.createObjectStore('workspace') });
    await old.put('workspace', JSON.stringify(workspace), 'current');
    await old.put('workspace', JSON.stringify({ cursor: 3 }), 'meta:sync');
    old.close();
    const device = new FakeNativeStore();
    const storage = await moveToNative(device.calls());
    expect(await storage!.load()).toEqual(workspace);
    expect(await storage!.loadMeta('sync')).toEqual({ cursor: 3 });
    expect(device.peek().kv.has('meta:current')).toBe(false);
    expect(await names()).toEqual([]);
  });

  it('marks a fresh install moved without making a web view database', async () => {
    const device = new FakeNativeStore();
    const storage = await moveToNative(device.calls());
    expect(await storage!.load()).toBeNull();
    expect(device.peek().kv.get('meta:movedFromWebView')).toBe('true');
    expect(await names()).toEqual([]);
  });

  it('moves nothing on a later start', async () => {
    await seedWebView(sampleWorkspace());
    const device = new FakeNativeStore();
    await moveToNative(device.calls());
    const saves = device.saves.length;
    const storage = await moveToNative(device.calls());
    expect(device.saves).toHaveLength(saves);
    expect(await storage!.load()).toEqual(sampleWorkspace());
  });

  it('leaves the web view’s copy alone when the native save fails, and counts it', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const device = new FakeNativeStore();
    for (let start = 1; start <= FAILURES_TO_SAY; start++) {
      sessionStorage.clear(); // a new start
      device.failing = { method: 'save', after: 0 };
      expect(await moveToNative(device.calls())).toBeNull();
      expect(nativeMoveFailures()).toBe(start);
    }
    // Nothing is left natively, not even the marker of a copy under way.
    expect(device.peek().header).toBeNull();
    expect(device.peek().kv.size).toBe(0);
    expect(await names()).toEqual(['pecklist', 'pecklist-records']);
    expect(await createIndexedDbStorage().load()).toEqual(workspace);
    // The next start that works moves it, and forgets the failures.
    const storage = await moveToNative(device.calls());
    expect(await storage!.load()).toEqual(workspace);
    expect(nativeMoveFailures()).toBe(0);
  });

  it('counts a start once, though the standalone app loads the page twice per start', async () => {
    await seedWebView(sampleWorkspace());
    const device = new FakeNativeStore();
    device.failing = { method: 'save', after: 0 };
    expect(await moveToNative(device.calls())).toBeNull();
    device.failing = { method: 'save', after: 0 };
    expect(await moveToNative(device.calls())).toBeNull();
    expect(nativeMoveFailures()).toBe(1);
  });

  it('wipes a copy that reads back differently and keeps the web view’s', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const device = new FakeNativeStore();
    const real = device.calls();
    // A store that loses an entity on the way back.
    const lossy: NativeStoreCalls = {
      ...real,
      load: async (after, budget) => {
        const page = await real.load(after, budget);
        return { ...page, rows: page.rows.slice(1) };
      },
    };
    expect(await moveToNative(lossy)).toBeNull();
    expect(device.peek().entities.size).toBe(0);
    expect(device.peek().kv.size).toBe(0);
    expect(await createIndexedDbStorage().load()).toEqual(workspace);
  });

  it('copies again over a copy cut off before its marker, wiping nothing of the web view’s first', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const device = new FakeNativeStore();
    const calls = device.calls();
    // The app stopped partway: meta:migrating, a part of the workspace and a stale value.
    await calls.put([
      ['meta:migrating', 'true'],
      ['meta:stale', '1'],
    ]);
    await calls.save({
      puts: [['tasks/partial', '{"id":"partial"}']],
      deletes: [],
      header: '{"doc":{},"order":{}}',
    });

    const storage = await moveToNative(calls);

    expect(await storage!.load()).toEqual(workspace);
    expect(device.peek().entities.has('tasks/partial')).toBe(false);
    expect(device.peek().kv.has('meta:stale')).toBe(false);
    expect(device.peek().kv.has('meta:migrating')).toBe(false);
  });

  it('never overwrites a native workspace this origin already has', async () => {
    const device = new FakeNativeStore();
    const own = renamed(sampleWorkspace(), 'Native');
    await createNativeStorage(device.calls()).save(own);
    await seedWebView(sampleWorkspace());
    const storage = await moveToNative(device.calls());
    expect(await storage!.load()).toEqual(own);
    expect(device.peek().kv.get('meta:movedFromWebView')).toBe('true');
    // Nothing unsynced in the web view's copy, so it goes.
    expect(await names()).toEqual([]);
  });

  it('drops a web view copy left after the move when nothing in it is unsynced', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    // An older server build ran on IndexedDB and synced everything.
    await seedWebView(renamed(sampleWorkspace(), 'Synced by the older build'), {
      ...allAcked(renamed(sampleWorkspace(), 'x')),
    });
    const storage = await moveToNative(device.calls());
    expect(await storage!.load()).toEqual(sampleWorkspace());
    expect(await names()).toEqual([]);
  });

  it('merges unsynced changes an older build left in the web view, so they sync from here', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    const offline = renamed(sampleWorkspace(), 'Made offline on the older build');
    await seedWebView(offline, allAcked(sampleWorkspace()));

    const storage = await moveToNative(device.calls());

    const merged = (await storage!.load()) as WorkspaceFile;
    expect(merged.entities.tasks[0]!.title).toBe('Made offline on the older build');
    const { acks } = (await storage!.loadMeta('sync')) as { acks: Acks };
    expect(pendingChanges(merged, acks).map((change) => change.entity.id)).toEqual([
      offline.entities.tasks[0]!.id,
    ]);
    expect(await names()).toEqual([]);
  });

  it('keeps a left web view copy with unsynced changes it cannot merge', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    const other = { ...renamed(sampleWorkspace(), 'Another account'), owner: 'U2' };
    await seedWebView(other, {});
    const storage = await moveToNative(device.calls());
    expect(await storage!.load()).toEqual(sampleWorkspace());
    expect(await names()).toEqual(['pecklist', 'pecklist-records']);
  });

  it('runs on the web view’s storage when the shell refuses the page', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const device = new FakeNativeStore();
    device.current = 'https://tasks.example.com';
    expect(await moveToNative(device.calls('https://localhost'))).toBeNull();
    expect(nativeMoveFailures()).toBe(0);
    expect(await createIndexedDbStorage().load()).toEqual(workspace);
  });

  it('starts without waiting for a slow move, which then never sets its marker', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const device = new FakeNativeStore();
    const real = device.calls();
    const slow = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    const sluggish: NativeStoreCalls = {
      ...real,
      save: async (change) => {
        await slow(150);
        return real.save(change);
      },
    };
    let finished = false;
    const started = moveToNativeWithin(sluggish, 20, 60).then((storage) => {
      finished = true;
      return storage;
    });
    expect(await started).toBeNull();
    expect(finished).toBe(true);
    await slow(400);
    expect(device.peek().kv.has('meta:movedFromWebView')).toBe(false);
    expect(device.peek().entities.size).toBe(0);
    expect(nativeMoveFailures()).toBe(0);
    expect(await createIndexedDbStorage().load()).toEqual(workspace);
  });

  it('hands over the native store and drops the web view’s copy when the move is quick', async () => {
    await seedWebView(sampleWorkspace());
    const device = new FakeNativeStore();
    const storage = await moveToNativeWithin(device.calls(), 2_000, 5_000);
    expect(storage?.kind).toBe('native');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await names()).toEqual([]);
  });

  it('compares by content, not key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } })).toBe(
      canonicalJson({ a: { d: [2, { x: 2, y: 1 }] }, b: 1 }),
    );
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});

describe('after Dev 1’s review: the time limit, a moved origin, leftovers (PL-070)', () => {
  afterEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    for (const name of await names()) if (name) await deleteDB(name);
  });

  const slow = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  it('hands over the native store when the marker is still being written as the copy limit passes', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const device = new FakeNativeStore();
    const real = device.calls();
    const slowMarker: NativeStoreCalls = {
      ...real,
      put: async (entries) => {
        if (entries.some(([key]) => key === 'meta:movedFromWebView')) await slow(150);
        return real.put(entries);
      },
    };
    const storage = await moveToNativeWithin(slowMarker, 20, 60);
    expect(storage?.kind).toBe('native');
    expect(await storage!.load()).toEqual(workspace);
    expect(device.peek().kv.get('meta:movedFromWebView')).toBe('true');
    expect(localStorage.getItem('pecklist.storageMoved')).toBe('native');
  });

  it('never starts a moved origin on IndexedDB: a store that fails at first is asked again', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const device = new FakeNativeStore();
    await moveToNative(device.calls());
    expect(localStorage.getItem('pecklist.storageMoved')).toBe('native');
    device.failing = { method: 'get', after: 0 };
    const storage = await moveToNativeWithin(device.calls(), 20, 60);
    expect(storage?.kind).toBe('native');
    expect(await storage!.load()).toEqual(workspace);
  });

  it('waits for a moved origin’s slow store rather than start without it', async () => {
    const workspace = sampleWorkspace();
    await seedWebView(workspace);
    const device = new FakeNativeStore();
    await moveToNative(device.calls());
    const real = device.calls();
    const sluggish: NativeStoreCalls = {
      ...real,
      get: async (key) => {
        await slow(150);
        return real.get(key);
      },
    };
    const storage = await moveToNativeWithin(sluggish, 20, 60);
    expect(await storage!.load()).toEqual(workspace);
  });

  it('gives a moved origin the native store even when it does not answer, so the app says so', async () => {
    await seedWebView(sampleWorkspace());
    const device = new FakeNativeStore();
    await moveToNative(device.calls());
    device.current = 'https://elsewhere.example';
    const storage = await moveToNativeWithin(device.calls('https://localhost'), 20, 60);
    expect(storage?.kind).toBe('native');
    await expect(storage!.load()).rejects.toThrow(/refused/);
    expect(await names()).toEqual([]);
  });

  it('brings a leftover on an older schema up to this one and merges its unsynced changes', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    const older = { ...renamed(sampleWorkspace(), 'Made on the older build'), schemaVersion: 19 };
    await seedWebView(older as WorkspaceFile, allAcked(sampleWorkspace()));

    const storage = await moveToNative(device.calls());

    const merged = (await storage!.load()) as WorkspaceFile;
    expect(merged.schemaVersion).toBe(sampleWorkspace().schemaVersion);
    expect(merged.entities.tasks[0]!.title).toBe('Made on the older build');
    expect(await names()).toEqual([]);
    expect(nativeMoveFailures()).toBe(0);
  });

  it('takes the leftover’s acknowledgements too, so what the older build synced does not go again', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    // The older build changed two tasks: the first it pushed (acknowledged), the second not yet.
    const both = renamed(renamed(sampleWorkspace(), 'Pushed by the older build'), 'x');
    const [, second] = both.entities.tasks;
    const leftover: WorkspaceFile = {
      ...both,
      entities: {
        ...both.entities,
        tasks: [
          { ...both.entities.tasks[0]!, title: 'Pushed by the older build' },
          {
            ...second!,
            title: 'Not pushed yet',
            _hlc: { ...second!._hlc, title: '2099-01-02T00:00:00.000Z-0000-older' },
          },
        ],
      },
    };
    const acks = {
      ...allAcked(sampleWorkspace()),
      ...allAcked({
        ...leftover,
        entities: { ...leftover.entities, tasks: [leftover.entities.tasks[0]!] },
      }),
    };
    await seedWebView(leftover, acks);

    const storage = await moveToNative(device.calls());

    const merged = (await storage!.load()) as WorkspaceFile;
    const meta = (await storage!.loadMeta('sync')) as { acks: Acks };
    expect(pendingChanges(merged, meta.acks).map((change) => change.entity.id)).toEqual([
      second!.id,
    ]);
  });

  it('flags a leftover it cannot merge for Settings to offer, and counts no failure', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    const other = { ...renamed(sampleWorkspace(), 'Another account'), owner: 'U2' };
    await seedWebView(other, {});
    await moveToNative(device.calls());
    sessionStorage.clear();
    await moveToNative(device.calls());
    expect(nativeMoveFailures()).toBe(0);
    expect(olderCopyKept()).toBe(true);
    expect(await names()).toEqual(['pecklist', 'pecklist-records']);
    expect(await olderCopy()).toEqual(other);
  });

  it('deletes a kept older copy on request, and its flag with it', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    await seedWebView({ ...renamed(sampleWorkspace(), 'Another account'), owner: 'U2' }, {});
    const storage = await moveToNative(device.calls());
    expect(await deleteOlderCopy()).toBe(true);
    expect(olderCopyKept()).toBe(false);
    expect(await names()).toEqual([]);
    expect(await olderCopy()).toBeNull();
    // The app's own copy is untouched, and the next start finds nothing to flag.
    expect(await storage!.load()).toEqual(sampleWorkspace());
    await moveToNative(device.calls());
    expect(olderCopyKept()).toBe(false);
  });

  it('forgets the flag when the older copy is gone by the next start', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    await seedWebView({ ...renamed(sampleWorkspace(), 'Another account'), owner: 'U2' }, {});
    await moveToNative(device.calls());
    expect(olderCopyKept()).toBe(true);
    for (const name of await names()) if (name) await deleteDB(name);
    await moveToNative(device.calls());
    expect(olderCopyKept()).toBe(false);
  });

  it('signing out wipes a kept leftover too, so it never moves in afterwards', async () => {
    const device = new FakeNativeStore();
    await seedWebView(sampleWorkspace());
    await moveToNative(device.calls());
    await seedWebView({ ...renamed(sampleWorkspace(), 'Another account'), owner: 'U2' }, {});
    const storage = await moveToNative(device.calls());
    await storage!.wipe();
    expect(await names()).toEqual([]);
    expect(olderCopyKept()).toBe(false);
    const next = await moveToNative(device.calls());
    expect(await next!.load()).toBeNull();
  });
});
