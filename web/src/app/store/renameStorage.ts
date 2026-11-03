import { deleteDB, openDB } from 'idb';

/**
 * Moves what this browser kept under the app's old name (Punchlist, before the rename: PL-127) to
 * the new one, once. Settings in localStorage and sessionStorage move synchronously, as soon as
 * this module is imported (main.tsx imports it first, so no other module has read a key yet). The
 * IndexedDB databases, where the workspace, its unsynced changes and attached files live, move in
 * moveDatabases(), which main.tsx awaits before the app starts.
 */

const OLD = 'punchlist';
const NEW = 'pecklist';

/** Every key that starts with the old name gets the new one, unless the new key is already set. */
export function moveKeys(storage: Storage): void {
  const old: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(OLD)) old.push(key);
  }
  for (const key of old) {
    const renamed = NEW + key.slice(OLD.length);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value);
    storage.removeItem(key);
  }
}

for (const storage of [() => localStorage, () => sessionStorage]) {
  try {
    moveKeys(storage());
  } catch {
    // No storage here (a private window that refuses it): nothing to move.
  }
}

/** The databases the app keeps: the workspace, its record store, and attached files. */
const DATABASES = ['', '-records', '-files'];

/**
 * Copies each old database into a new one of the same shape, then deletes the old one. Nothing
 * happens where the new database already exists (moved before) or the old one never did. A copy
 * that fails leaves the old database as it was, so the next start tries again.
 */
export async function moveDatabases(): Promise<void> {
  for (const suffix of DATABASES) {
    try {
      await moveDatabase(OLD + suffix, NEW + suffix);
    } catch (error) {
      console.warn(
        `Could not move ${OLD + suffix} to ${NEW + suffix}; trying again next time`,
        error,
      );
    }
  }
}

async function moveDatabase(from: string, to: string): Promise<void> {
  // Opening without a version never upgrades: a database that did not exist comes back empty.
  const old = await openDB(from);
  const stores = [...old.objectStoreNames];
  if (stores.length === 0) {
    old.close();
    forget(from);
    return;
  }
  const existing = await openDB(to);
  const moved = existing.objectStoreNames.length > 0;
  existing.close();
  if (moved) {
    old.close();
    return;
  }
  await deleteDB(to);

  const shapes = stores.map((name) => {
    const store = old.transaction(name).objectStore(name);
    return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement };
  });
  const target = await openDB(to, old.version, {
    upgrade(database) {
      for (const shape of shapes) {
        database.createObjectStore(shape.name, {
          keyPath: shape.keyPath,
          autoIncrement: shape.autoIncrement,
        });
      }
    },
  });
  try {
    for (const name of stores) {
      const read = old.transaction(name);
      const [keys, values] = await Promise.all([read.store.getAllKeys(), read.store.getAll()]);
      await read.done;
      const write = target.transaction(name, 'readwrite');
      const inline = write.store.keyPath !== null;
      await Promise.all(
        values.map((value, index) =>
          inline ? write.store.put(value) : write.store.put(value, keys[index]),
        ),
      );
      await write.done;
    }
  } catch (error) {
    // Half a copy is worse than none: drop it and keep the old database for the next try.
    target.close();
    old.close();
    await deleteDB(to);
    throw error;
  }
  target.close();
  old.close();
  forget(from);
}

/**
 * Deletes the old database without waiting: a tab still running the old version keeps it open,
 * and the deletion then finishes when that tab closes instead of holding up this start.
 */
function forget(name: string): void {
  void deleteDB(name).catch(() => undefined);
}
