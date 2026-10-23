import { openDB, type IDBPDatabase } from 'idb';
import type { BlobStore } from '../ports/blobs.ts';

const STORE = 'blobs';

interface Stored {
  type: string;
  bytes: ArrayBuffer;
}

/**
 * Files in their own IndexedDB database, apart from the workspace. Kept as bytes plus a type, not
 * as Blobs: some browsers (older Safari) cannot store a Blob in IndexedDB.
 */
export function createIndexedDbBlobs(databaseName = 'punchlist-files'): BlobStore {
  let db: Promise<IDBPDatabase> | null = null;
  const open = () =>
    (db ??= openDB(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore(STORE);
      },
    }));
  return {
    async get(sha256) {
      const stored = (await (await open()).get(STORE, sha256)) as Stored | undefined;
      return stored ? new Blob([stored.bytes], { type: stored.type }) : null;
    },
    async put(sha256, blob) {
      const stored: Stored = { type: blob.type, bytes: await blob.arrayBuffer() };
      await (await open()).put(STORE, stored, sha256);
    },
    async has(sha256) {
      return (await (await open()).getKey(STORE, sha256)) !== undefined;
    },
    async delete(sha256) {
      await (await open()).delete(STORE, sha256);
    },
  };
}
