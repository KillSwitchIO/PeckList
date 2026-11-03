import { deleteDB, openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { moveDatabases, moveKeys } from './renameStorage.ts';

const names = async () => (await indexedDB.databases()).map((each) => each.name).sort();

describe('moving storage from the old name (PL-127)', () => {
  afterEach(async () => {
    localStorage.clear();
    for (const name of await names()) if (name) await deleteDB(name);
  });

  it('moves settings to the new keys and keeps one already set there', () => {
    localStorage.setItem('punchlist.themeMode', 'dark');
    localStorage.setItem('punchlist.deviceId', 'old-device');
    localStorage.setItem('pecklist.deviceId', 'new-device');
    localStorage.setItem('punchlistOpenedTask', 't1');
    localStorage.setItem('other.key', 'kept');

    moveKeys(localStorage);

    expect(localStorage.getItem('pecklist.themeMode')).toBe('dark');
    expect(localStorage.getItem('pecklist.deviceId')).toBe('new-device');
    expect(localStorage.getItem('pecklistOpenedTask')).toBe('t1');
    expect(localStorage.getItem('other.key')).toBe('kept');
    expect(Object.keys(localStorage).filter((key) => key.startsWith('punchlist'))).toEqual([]);
  });

  it('copies the workspace, its records and the files into the new databases, then drops the old', async () => {
    const workspace = await openDB('punchlist', 1, {
      upgrade: (db) => db.createObjectStore('workspace'),
    });
    await workspace.put('workspace', '{"legacy":true}', 'current');
    workspace.close();
    const records = await openDB('punchlist-records', 1, {
      upgrade: (db) => {
        db.createObjectStore('entities');
        db.createObjectStore('doc');
      },
    });
    await records.put('entities', { id: 't1', title: 'Unsynced task' }, 'tasks/t1');
    await records.put('doc', { order: { tasks: ['t1'] } }, 'header');
    records.close();
    const files = await openDB('punchlist-files', 1, {
      upgrade: (db) => db.createObjectStore('blobs'),
    });
    await files.put('blobs', { type: 'text/plain', bytes: new Uint8Array([1, 2]).buffer }, 'sha-1');
    files.close();

    await moveDatabases();

    const moved = await openDB('pecklist-records', 1);
    expect(await moved.get('entities', 'tasks/t1')).toEqual({ id: 't1', title: 'Unsynced task' });
    expect(await moved.get('doc', 'header')).toEqual({ order: { tasks: ['t1'] } });
    moved.close();
    const movedWorkspace = await openDB('pecklist', 1);
    expect(await movedWorkspace.get('workspace', 'current')).toBe('{"legacy":true}');
    movedWorkspace.close();
    const movedFiles = await openDB('pecklist-files', 1);
    expect(((await movedFiles.get('blobs', 'sha-1')) as { type: string }).type).toBe('text/plain');
    movedFiles.close();
    await expect.poll(names).toEqual(['pecklist', 'pecklist-files', 'pecklist-records']);
  });

  it('leaves a database that was already moved alone, and creates nothing when there was none', async () => {
    const already = await openDB('pecklist-records', 1, {
      upgrade: (db) => db.createObjectStore('entities'),
    });
    await already.put('entities', 'newer', 'tasks/t1');
    already.close();
    const stale = await openDB('punchlist-records', 1, {
      upgrade: (db) => db.createObjectStore('entities'),
    });
    await stale.put('entities', 'older', 'tasks/t1');
    stale.close();

    await moveDatabases();

    const kept = await openDB('pecklist-records', 1);
    expect(await kept.get('entities', 'tasks/t1')).toBe('newer');
    kept.close();
    await expect.poll(names).toEqual(['pecklist-records', 'punchlist-records']);
  });
});
