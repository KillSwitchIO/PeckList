import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { sampleWorkspace } from '../test/fixtures.ts';
import { createIndexedDbStorage } from './indexeddb-storage.ts';
import { createMemoryStorage } from './memory-storage.ts';
import { describeStorageContract } from './storage.contract.ts';

describeStorageContract('memory', () => createMemoryStorage());

let counter = 0;
describeStorageContract('indexeddb', () =>
  createIndexedDbStorage(`punchlist-test-${(counter += 1)}`),
);

describe('IndexedDB storage, one record per entity', () => {
  it('reads a workspace an older version saved as one text, then keeps it as records', async () => {
    const name = `punchlist-legacy-${(counter += 1)}`;
    const workspace = sampleWorkspace();
    const old = await openDB(name, 1, {
      upgrade: (database) => void database.createObjectStore('workspace'),
    });
    await old.put('workspace', JSON.stringify(workspace), 'current');
    old.close();
    const storage = createIndexedDbStorage(name);
    expect(await storage.load()).toEqual(workspace);
    await storage.save(workspace);
    const reopened = await openDB(name, 1);
    expect(await reopened.get('workspace', 'current')).toBeUndefined();
    reopened.close();
    expect(await createIndexedDbStorage(name).load()).toEqual(workspace);
  });

  it('writes only the entities that changed, and drops the ones that went', async () => {
    const name = `punchlist-diff-${(counter += 1)}`;
    const storage = createIndexedDbStorage(name);
    const workspace = sampleWorkspace();
    await storage.save(workspace);
    const [first, second] = workspace.entities.tasks;
    const changed = {
      ...workspace,
      entities: { ...workspace.entities, tasks: [{ ...first!, title: 'Renamed' }] },
    };
    const puts: string[] = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value, key) {
      puts.push(`${this.name}:${String(key)}`);
      return put.call(this, value, key);
    };
    try {
      await storage.save(changed);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    expect(puts).toEqual([`entities:tasks/${first!.id}`, 'doc:header']);
    const loaded = (await createIndexedDbStorage(name).load()) as typeof workspace;
    expect(loaded.entities.tasks.map((task) => task.title)).toEqual(['Renamed']);
    expect(loaded.entities.tasks.some((task) => task.id === second!.id)).toBe(false);
    expect(loaded).toEqual(changed);
  });
});
