import { openDB, type IDBPDatabase } from 'idb';
import type { WorkspaceFile } from '../core/types.ts';
import type { StorageAdapter } from '../ports/storage.ts';

const STORE = 'workspace';
const KEY = 'current';

/** Keeps the workspace document in IndexedDB, as the JSON text that would be written to a file. */
export function createIndexedDbStorage(databaseName = 'punchlist'): StorageAdapter {
  let db: Promise<IDBPDatabase> | null = null;
  const open = () =>
    (db ??= openDB(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore(STORE);
      },
    }));

  return {
    kind: 'indexeddb',
    async load() {
      const text = (await (await open()).get(STORE, KEY)) as string | undefined;
      return text === undefined ? null : (JSON.parse(text) as unknown);
    },
    async save(workspace: WorkspaceFile) {
      await (await open()).put(STORE, JSON.stringify(workspace), KEY);
    },
    async clear() {
      await (await open()).delete(STORE, KEY);
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
