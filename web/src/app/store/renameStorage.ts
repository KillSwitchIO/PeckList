import { deleteDB, openDB, type IDBPDatabase } from 'idb';

/**
 * Moves what this browser kept under the app's old name (Punchlist, before the rename: PL-127) to
 * the new one, once. Settings in localStorage and sessionStorage move synchronously, as soon as
 * this module is imported (main.tsx imports it first, so no other module has read a key yet). The
 * IndexedDB databases, where the workspace, its unsynced changes and attached files live, move in
 * moveDatabases(), which main.tsx awaits (for a few seconds at most) before the app starts.
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

/** How a move is told it ran too long, and tells when it is copying (and must not be cut off). */
interface MoveControl {
  late: () => boolean;
  copying: (on: boolean) => void;
}

const unbounded: MoveControl = { late: () => false, copying: () => undefined };

/**
 * The old databases this browser still has. Opening one to find out would create it (and, empty,
 * delete it again): six writes to disk on every start, before the app shows anything. Where the
 * browser cannot list its databases, all of them, to be opened and seen.
 */
async function oldDatabases(): Promise<string[]> {
  const all = DATABASES.map((suffix) => OLD + suffix);
  if (typeof indexedDB.databases !== 'function') return all;
  try {
    const present = new Set((await indexedDB.databases()).map((each) => each.name));
    return all.filter((name) => present.has(name));
  } catch {
    return all;
  }
}

/**
 * Copies each old database into a new one of the same shape, then deletes the old one. Nothing
 * happens where the new database already exists (moved before) or the old one never did. A copy
 * that fails leaves the old database as it was, so the next start tries again. Once `late` says
 * so, a database whose copy has not begun is left for the next start.
 */
export async function moveDatabases(control: MoveControl = unbounded): Promise<void> {
  for (const from of await oldDatabases()) {
    if (control.late()) return;
    const to = NEW + from.slice(OLD.length);
    try {
      await moveDatabase(from, to, control);
    } catch (error) {
      console.warn(`Could not move ${from} to ${to}; trying again next time`, error);
    }
  }
}

/**
 * moveDatabases, but the app never waits long for it: after `limit` ms it starts anyway, whatever
 * the move is doing (a slow disk, or a deletion another tab holds up), and what has not begun to
 * copy is moved at the next start. A copy already under way gets until `copyLimit`, so the app does
 * not open a database that is still being filled.
 */
export function moveDatabasesWithin(limit = 3_000, copyLimit = 20_000): Promise<void> {
  let late = false;
  let copying = false;
  return new Promise((resolve) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const done = () => {
      timers.forEach(clearTimeout);
      resolve();
    };
    timers.push(
      setTimeout(() => {
        late = true;
        console.warn(
          'Moving the old databases is taking long: starting anyway, it goes on next time',
        );
        if (copying) timers.push(setTimeout(done, copyLimit - limit));
        else done();
      }, limit),
    );
    void moveDatabases({ late: () => late, copying: (on) => (copying = on) }).finally(done);
  });
}

async function moveDatabase(from: string, to: string, control: MoveControl): Promise<void> {
  // Opening without a version never upgrades: a database that did not exist comes back empty.
  const old = await openDB(from);
  const stores = [...old.objectStoreNames];
  if (stores.length === 0) {
    old.close();
    forget(from);
    return;
  }
  if (control.late()) {
    // The app has started without it: copying now could fill a database it already has open.
    old.close();
    return;
  }
  control.copying(true);
  try {
    await copyDatabase(old, stores, to);
  } finally {
    control.copying(false);
  }
}

async function copyDatabase(old: IDBPDatabase, stores: string[], to: string): Promise<void> {
  const from = old.name;
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
 * and the deletion then finishes when that tab closes instead of holding up this start. Until it
 * does, a later start's open of that database waits behind it; moveDatabasesWithin bounds that.
 */
function forget(name: string): void {
  void deleteDB(name).catch(() => undefined);
}
