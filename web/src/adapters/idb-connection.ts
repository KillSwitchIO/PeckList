import { openDB, type IDBPDatabase, type OpenDBCallbacks } from 'idb';

/**
 * Opens a database on first use and keeps it open, but gives way: deleting or upgrading a database
 * waits until every connection to it is closed, so when another tab (or a start of the app moving
 * its data) asks, this connection closes and the next use opens it again. Transactions already
 * under way finish first. A connection the browser closed by itself is opened again too.
 */
export function yieldingConnection(
  name: string,
  version: number,
  upgrade: NonNullable<OpenDBCallbacks<unknown>['upgrade']>,
): () => Promise<IDBPDatabase> {
  let db: Promise<IDBPDatabase> | null = null;
  return () => {
    if (db) return db;
    const opening: Promise<IDBPDatabase> = openDB(name, version, {
      upgrade,
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
        if (db === opening) db = null;
      },
      terminated() {
        if (db === opening) db = null;
      },
    });
    db = opening;
    return opening;
  };
}
