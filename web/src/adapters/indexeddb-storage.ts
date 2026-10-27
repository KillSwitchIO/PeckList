import { openDB, type IDBPDatabase } from 'idb';
import { mergeWorkspaces } from '../core/merge.ts';
import { COLLECTIONS, type WorkspaceFile } from '../core/types.ts';
import type { StorageAdapter } from '../ports/storage.ts';

const STORE = 'workspace';
const LEGACY = 'current';
const ENTITIES = 'entities';
const DOC = 'doc';
const HEADER = 'header';

/** The workspace minus its entities, and each collection's ids in order. */
interface Header {
  doc: Omit<WorkspaceFile, 'entities'>;
  order: Record<string, string[]>;
}

/** What storage holds, as last read or written: entity objects by `collection/id`. */
interface Held {
  entities: Map<string, unknown>;
  header: string;
  order: Record<string, string[]>;
}

const keyOf = (collection: string, id: string) => `${collection}/${id}`;

const sameIds = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined && a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Keeps the workspace in IndexedDB one record per entity (R-FB-94, audit P5): a save writes the
 * entities that changed since storage was last read or written, not the whole document (9 MB at
 * 4,500 tasks). Backups and device metadata stay in the first database as JSON text, as does a
 * workspace saved by an older version: read and taken in like another tab's save (merged), and
 * dropped by the next save while it is still the text that was read.
 */
export function createIndexedDbStorage(databaseName = 'punchlist'): StorageAdapter {
  let db: Promise<IDBPDatabase> | null = null;
  let records: Promise<IDBPDatabase> | null = null;
  const open = () =>
    (db ??= openDB(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore(STORE);
      },
    }));
  // Its own database, so no tab of an older version blocks an upgrade of the first one.
  const openRecords = () =>
    (records ??= openDB(`${databaseName}-records`, 1, {
      upgrade(database) {
        database.createObjectStore(ENTITIES);
        database.createObjectStore(DOC);
      },
    }));
  let held: Held | null = null;
  // The old single-text copy as last read: a save drops it only while it is still that text.
  let legacySeen: string | null = null;
  const readLegacy = async () => {
    const text = (await (await open()).get(STORE, LEGACY)) as string | undefined;
    legacySeen = text ?? null;
    return text;
  };

  return {
    kind: 'indexeddb',
    async load() {
      const store = await openRecords();
      const tx = store.transaction([ENTITIES, DOC], 'readonly');
      const header = (await tx.objectStore(DOC).get(HEADER)) as Header | undefined;
      if (!header) {
        await tx.done;
        held = null;
        const text = await readLegacy();
        return text === undefined ? null : (JSON.parse(text) as unknown);
      }
      const [keys, values] = await Promise.all([
        tx.objectStore(ENTITIES).getAllKeys(),
        tx.objectStore(ENTITIES).getAll(),
      ]);
      await tx.done;
      const byKey = new Map<string, unknown>();
      keys.forEach((key, index) => byKey.set(String(key), values[index]));
      const entities: Record<string, unknown[]> = {};
      const placed = new Set<string>();
      for (const collection of COLLECTIONS) {
        const list: unknown[] = [];
        for (const id of header.order[collection] ?? []) {
          const key = keyOf(collection, id);
          const entity = byKey.get(key);
          if (entity !== undefined) {
            list.push(entity);
            placed.add(key);
          }
        }
        entities[collection] = list;
      }
      // Anything the order does not name (it should not happen) still comes back.
      for (const [key, entity] of byKey) {
        if (placed.has(key)) continue;
        const collection = key.slice(0, key.indexOf('/'));
        (entities[collection] ??= []).push(entity);
      }
      held = { entities: byKey, header: JSON.stringify(header.doc), order: header.order };
      const stored = { ...header.doc, entities } as unknown as WorkspaceFile;
      // A tab of an older version, still open, saves the old way: that is another tab's save,
      // taken in like one (dropped once the records hold it, see save).
      const text = await readLegacy();
      if (text === undefined) return stored;
      try {
        return mergeWorkspaces(stored, JSON.parse(text) as WorkspaceFile);
      } catch {
        // Another owner or schema: the records are this version's, they win.
        return stored;
      }
    },
    async save(workspace: WorkspaceFile) {
      const { entities, ...doc } = workspace;
      const store = await openRecords();
      const tx = store.transaction([ENTITIES, DOC], 'readwrite');
      const records = tx.objectStore(ENTITIES);
      const writes: Promise<unknown>[] = [];
      const now = new Map<string, unknown>();
      const order: Record<string, string[]> = {};
      if (!held) writes.push(records.clear());
      for (const collection of COLLECTIONS) {
        const ids: string[] = [];
        for (const entity of (entities[collection] ?? []) as { id: string }[]) {
          const key = keyOf(collection, entity.id);
          ids.push(entity.id);
          now.set(key, entity);
          if (held?.entities.get(key) !== entity) writes.push(records.put(entity, key));
        }
        order[collection] = ids;
      }
      if (held) {
        for (const key of held.entities.keys()) {
          if (!now.has(key)) writes.push(records.delete(key));
        }
      }
      const header = JSON.stringify(doc);
      const reordered = COLLECTIONS.some(
        (collection) => !sameIds(held?.order[collection], order[collection]!),
      );
      if (!held || header !== held.header || reordered) {
        writes.push(tx.objectStore(DOC).put({ doc, order } satisfies Header, HEADER));
      }
      await Promise.all([...writes, tx.done]);
      held = { entities: now, header, order };
      // The copy an older version keeps as one text goes once the records hold it: only the text
      // last read (taken in with that load). One an older tab wrote since stays for the next load.
      if (legacySeen !== null) {
        const legacy = await open();
        if ((await legacy.getKey(STORE, LEGACY)) !== undefined) {
          if ((await legacy.get(STORE, LEGACY)) === legacySeen) await legacy.delete(STORE, LEGACY);
        }
        legacySeen = null;
      }
    },
    async clear() {
      const store = await openRecords();
      const tx = store.transaction([ENTITIES, DOC], 'readwrite');
      await Promise.all([tx.objectStore(ENTITIES).clear(), tx.objectStore(DOC).clear(), tx.done]);
      held = null;
      legacySeen = null;
      await (await open()).delete(STORE, LEGACY);
    },
    async backup(name: string, document: unknown) {
      await (await open()).put(STORE, JSON.stringify(document), `backup:${name}`);
    },
    async loadBackup(name: string) {
      const text = (await (await open()).get(STORE, `backup:${name}`)) as string | undefined;
      return text === undefined ? null : (JSON.parse(text) as unknown);
    },
    async loadMeta(key: string) {
      const text = (await (await open()).get(STORE, `meta:${key}`)) as string | undefined;
      return text === undefined ? null : (JSON.parse(text) as unknown);
    },
    async saveMeta(key: string, value: unknown) {
      await (await open()).put(STORE, JSON.stringify(value), `meta:${key}`);
    },
  };
}
