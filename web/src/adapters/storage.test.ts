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

  it("takes in a save an older version's tab makes, and drops it only once taken in", async () => {
    const name = `punchlist-mixed-${(counter += 1)}`;
    const storage = createIndexedDbStorage(name);
    const workspace = sampleWorkspace();
    await storage.save(workspace);
    // A tab of the older version, still open, saves the whole workspace as one text.
    const [first] = workspace.entities.tasks;
    const older = {
      ...workspace,
      entities: {
        ...workspace.entities,
        tasks: workspace.entities.tasks.map((task) =>
          task.id === first!.id
            ? {
                ...task,
                title: 'Renamed in the old tab',
                _hlc: { ...task._hlc, title: '2099-01-01T00:00:00.000Z-0000-old' },
              }
            : task,
        ),
      },
    };
    const writeOld = async (document: unknown) => {
      const db = await openDB(name, 1, {
        upgrade: (database) => void database.createObjectStore('workspace'),
      });
      await db.put('workspace', JSON.stringify(document), 'current');
      db.close();
    };
    await writeOld(older);
    const loaded = (await storage.load()) as typeof workspace;
    expect(loaded.entities.tasks.find((task) => task.id === first!.id)?.title).toBe(
      'Renamed in the old tab',
    );
    // The old tab saves again before this one does: that text must not be dropped unread.
    const again = { ...older, sync: { server: null, cursor: 'old-tab-again' } };
    await writeOld(again);
    await storage.save(loaded);
    const db = await openDB(name, 1);
    expect(await db.get('workspace', 'current')).toBe(JSON.stringify(again));
    db.close();
    // Read in again, it goes on the next save.
    await storage.save((await storage.load()) as typeof workspace);
    const after = await openDB(name, 1);
    expect(await after.get('workspace', 'current')).toBeUndefined();
    after.close();
    const final = (await createIndexedDbStorage(name).load()) as typeof workspace;
    expect(final.entities.tasks.find((task) => task.id === first!.id)?.title).toBe(
      'Renamed in the old tab',
    );
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
