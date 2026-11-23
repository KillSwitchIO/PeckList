import { deleteDB, openDB } from 'idb';
import { createAjvValidator } from '../../adapters/ajv-validator.ts';
import { createIndexedDbStorage } from '../../adapters/indexeddb-storage.ts';
import { createNativeStorage } from '../../adapters/native-storage.ts';
import { compareHlc } from '../../core/hlc.ts';
import { openDocument, upgradeDocument } from '../../core/io.ts';
import { mergeWorkspaces } from '../../core/merge.ts';
import { backupName } from '../../core/migrations.ts';
import { pendingChanges, type Acks } from '../../core/sync.ts';
import { COLLECTIONS, type WorkspaceFile } from '../../core/types.ts';
import type { NativeStoreCalls } from '../../ports/nativeShell.ts';
import type { StorageAdapter } from '../../ports/storage.ts';
import { NATIVE_STORE_API, nativeShell } from '../native/shell.ts';

/**
 * Moves the Android app's data from the WebView's IndexedDB to the app's own SQLite (PL-070, shell
 * api 16), once per origin, when that origin's page starts on a shell that has it. main.tsx awaits
 * {@link prepareNativeStorage} before the app starts, and the composition root takes
 * {@link pickedStorage}: the native store once the move is done, else IndexedDB as before.
 *
 * Nothing is lost or doubled:
 * - `meta:migrating` is set natively before the copy. A copy cut off (the app stopped, a read-back
 *   that differs) leaves it, and the next start wipes the native copy and copies again. A native
 *   workspace without it is trusted.
 * - The marker `meta:movedFromWebView` is set, and `meta:migrating` removed, in one transaction,
 *   only once the copy reads back the same.
 * - The WebView's copy is deleted only after the marker, and only once the app runs on the native
 *   store.
 * - With the marker already set and IndexedDB back (an older server build ran on it), IndexedDB is
 *   deleted only when it holds no unsynced changes; with some, they are merged into the native copy
 *   first (brought to this schema, with their acknowledgements), from where they sync.
 * - An origin that has moved never runs on IndexedDB again (it is empty: a fresh workspace there
 *   would be another owner's): `pecklist.storageMoved` in localStorage says so, and its start has
 *   no time limit. If the native store fails then, the app says so instead.
 * - Signing out wipes a kept IndexedDB copy too, so it cannot come back by moving again.
 * - A kept copy that cannot be merged (another owner, a schema this app cannot read) is flagged
 *   for Settings > Your data, which offers to bring it in through the import path or delete it.
 */

const MOVED = 'meta:movedFromWebView';
const MIGRATING = 'meta:migrating';
const SYNC = 'sync';

/** How many moves in a row failed (localStorage, per origin): Settings says so from {@link FAILURES_TO_SAY}. */
const FAILURES_KEY = 'pecklist.nativeMoveFailures';
export const FAILURES_TO_SAY = 3;

/** A failure already counted this session (sessionStorage): the standalone page loads twice per start. */
const COUNTED_KEY = 'pecklist.nativeMoveCounted';

/** An older copy in the WebView that could not be merged is kept (localStorage, per origin). */
const OLDER_COPY_KEY = 'pecklist.olderCopyKept';

/** Whether an older copy that could not be merged is kept in the WebView's storage. */
export function olderCopyKept(): boolean {
  try {
    return localStorage.getItem(OLDER_COPY_KEY) === 'true';
  } catch {
    return false;
  }
}

function keepOlderCopy(kept: boolean): void {
  try {
    if (kept) localStorage.setItem(OLDER_COPY_KEY, 'true');
    else localStorage.removeItem(OLDER_COPY_KEY);
  } catch {
    // No localStorage: Settings cannot offer it, and the copy stays as before.
  }
}

/** This origin's data is in the native store (localStorage, per origin): never IndexedDB again. */
const MOVED_HERE = 'pecklist.storageMoved';

function movedHere(): boolean {
  try {
    return localStorage.getItem(MOVED_HERE) === 'native';
  } catch {
    return false;
  }
}

function rememberMoved(): void {
  try {
    localStorage.setItem(MOVED_HERE, 'native');
  } catch {
    // No localStorage: the native marker still says so, as long as the store answers.
  }
}

export interface MoveOptions {
  /** The IndexedDB database the WebView kept the workspace in (and `-records` after it). */
  databaseName?: string;
  /** True once the app has started without waiting: the move must not finish then. */
  late?: () => boolean;
  /** Says when it is copying, which a time limit lets run on for longer. */
  copying?: (on: boolean) => void;
  /**
   * Says the outcome is the native store, from the moment the marker is being written (or found):
   * a time limit must not start the app on IndexedDB after that.
   */
  decided?: () => void;
}

/** The app started without waiting for the move. */
class Late extends Error {}

/** JSON with each object's keys sorted, so two copies compare by content, not key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field && typeof field === 'object' && !Array.isArray(field)
      ? Object.fromEntries(
          Object.keys(field)
            .sort()
            .map((key) => [key, (field as Record<string, unknown>)[key]]),
        )
      : field,
  );
}

/** A workspace as a save keeps it: each known collection, in order, and no other. */
function asSaved(workspace: WorkspaceFile): WorkspaceFile {
  const entities = workspace.entities as unknown as Record<string, unknown[] | undefined>;
  return {
    ...workspace,
    entities: Object.fromEntries(
      COLLECTIONS.map((collection) => [collection, entities[collection] ?? []]),
    ) as unknown as WorkspaceFile['entities'],
  };
}

/** Which of the WebView's workspace databases exist, without opening (and so making) one. */
async function webViewDatabases(name: string): Promise<string[]> {
  const ours = [name, `${name}-records`];
  if (typeof indexedDB.databases === 'function') {
    const present = new Set((await indexedDB.databases()).map((each) => each.name));
    return ours.filter((each) => present.has(each));
  }
  // No list (an old WebView): open each without a version, which makes an empty one if there was
  // none; that one goes again.
  const found: string[] = [];
  for (const each of ours) {
    const database = await openDB(each);
    const empty = database.objectStoreNames.length === 0;
    database.close();
    if (empty) void deleteDB(each).catch(() => undefined);
    else found.push(each);
  }
  return found;
}

/** The backups and device metadata the WebView kept, as the JSON text they were kept as. */
async function rawEntries(name: string): Promise<[string, string][]> {
  const database = await openDB(name);
  try {
    if (!database.objectStoreNames.contains('workspace')) return [];
    const read = database.transaction('workspace');
    const [keys, values] = await Promise.all([read.store.getAllKeys(), read.store.getAll()]);
    await read.done;
    const entries: [string, string][] = [];
    keys.forEach((key, index) => {
      const value = values[index] as unknown;
      // 'current' is the workspace as an older version kept it, read with the records.
      if (typeof key === 'string' && key !== 'current' && typeof value === 'string') {
        entries.push([key, value]);
      }
    });
    return entries;
  } finally {
    database.close();
  }
}

/** Deletes the WebView's workspace databases; attached files (`-files`) stay. Never waits long. */
async function dropWebView(name: string): Promise<void> {
  const giveUp = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  await Promise.race([
    Promise.all([deleteDB(name), deleteDB(`${name}-records`)]).catch((error: unknown) => {
      console.warn('Could not delete the web view’s copy; trying again next start', error);
    }),
    giveUp,
  ]);
}

function countFailure(): void {
  try {
    // Once per session: the standalone app loads the page twice per start (QA, D3).
    if (sessionStorage.getItem(COUNTED_KEY) === 'true') return;
    sessionStorage.setItem(COUNTED_KEY, 'true');
    localStorage.setItem(FAILURES_KEY, String(nativeMoveFailures() + 1));
  } catch {
    // No localStorage: nothing to count in.
  }
}

/** How many starts in a row could not move the data to the app's own storage. */
export function nativeMoveFailures(): number {
  try {
    const count = Number(localStorage.getItem(FAILURES_KEY));
    return Number.isInteger(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

function forgetFailures(): void {
  try {
    localStorage.removeItem(FAILURES_KEY);
  } catch {
    // Nothing kept.
  }
}

/**
 * Copies the WebView's workspace, backups and device metadata into the native store under
 * `meta:migrating`, reads it all back, and only then sets the marker. True when moved (or nothing
 * was there to move); false, with the native copy wiped, when not.
 */
async function copyWebView(store: NativeStoreCalls, options: MoveOptions): Promise<boolean> {
  const name = options.databaseName ?? 'pecklist';
  if ((await webViewDatabases(name)).length === 0) {
    options.decided?.();
    await store.put([
      [MOVED, 'true'],
      [MIGRATING, null],
    ]);
    rememberMoved();
    return true;
  }
  options.copying?.(true);
  try {
    await store.put([[MIGRATING, 'true']]);
    const loaded = (await createIndexedDbStorage(name).load()) as WorkspaceFile | null;
    const workspace = loaded && asSaved(loaded);
    const raw = await rawEntries(name);
    // One at a time: a backup can be as big as the workspace.
    for (const entry of raw) await store.put([entry]);
    if (workspace) await createNativeStorage(store).save(workspace);
    const back = await createNativeStorage(store).load();
    if (canonicalJson(back) !== canonicalJson(workspace)) {
      throw new Error('the copy reads back differently');
    }
    for (const [key, text] of raw) {
      if ((await store.get(key)) !== text) throw new Error(`${key} reads back differently`);
    }
    if (options.late?.()) throw new Late();
    // From here the app runs on the native store, however long the marker takes to write.
    options.decided?.();
    await store.put([
      [MOVED, 'true'],
      [MIGRATING, null],
    ]);
    rememberMoved();
    forgetFailures();
    return true;
  } catch (error) {
    await store.wipe().catch(() => undefined);
    if (!(error instanceof Late)) {
      countFailure();
      console.warn(
        'Could not move the data to the app’s own storage; trying again next start',
        error,
      );
    }
    return false;
  } finally {
    options.copying?.(false);
  }
}

/** A workspace at this app's schema, upgraded when older (`backUp` keeps the older one first); null when it cannot be. */
async function atThisSchema(
  document: unknown,
  backUp?: (from: number, older: unknown) => Promise<void>,
): Promise<WorkspaceFile | null> {
  const validator = createAjvValidator();
  const opened = openDocument(document, validator);
  if (opened.kind === 'ok') return opened.workspace;
  if (opened.kind !== 'needs-upgrade') return null;
  const upgraded = upgradeDocument(opened.document, validator);
  if (upgraded.kind !== 'ok') return null;
  await backUp?.(opened.from, opened.document);
  return upgraded.workspace;
}

/** Each entity's newer acknowledgement of the two. */
function newerAcks(mine: Acks, theirs: Acks): Acks {
  const acks = { ...mine };
  for (const [id, hlc] of Object.entries(theirs)) {
    if (compareHlc(hlc, acks[id]) > 0) acks[id] = hlc;
  }
  return acks;
}

/**
 * IndexedDB back after the move (an older server build ran on it): whether it may go. Unsynced
 * changes in it are merged into the native copy first, both brought to this app's schema (the
 * native one backed up first, as the upgrade screen does), with the newer acknowledgement of each
 * entity, so what the older build already synced does not go again. A copy that cannot be merged
 * (another owner, a schema this app cannot read) stays, flagged for Settings to offer.
 */
async function takeInLeftover(store: NativeStoreCalls, options: MoveOptions): Promise<boolean> {
  const name = options.databaseName ?? 'pecklist';
  if ((await webViewDatabases(name)).length === 0) {
    keepOlderCopy(false);
    return false;
  }
  const webView = createIndexedDbStorage(name);
  const left = (await webView.load()) as WorkspaceFile | null;
  const leftAcks = ((await webView.loadMeta(SYNC)) as { acks?: Acks } | null)?.acks ?? {};
  if (!left || pendingChanges(asSaved(left), leftAcks).length === 0) {
    keepOlderCopy(false);
    return true;
  }
  const native = createNativeStorage(store);
  const stored = await native.load();
  let merged: WorkspaceFile | null = null;
  try {
    const theirs = await atThisSchema(asSaved(left));
    const mine =
      stored === null
        ? null
        : await atThisSchema(stored, (from, older) =>
            native.backup(backupName('workspace', from), older),
          );
    if (theirs && (stored === null || mine)) merged = mine ? mergeWorkspaces(mine, theirs) : theirs;
  } catch (error) {
    console.warn('The web view’s unsynced changes cannot be merged', error);
  }
  if (!merged) {
    keepOlderCopy(true);
    console.warn('The web view’s storage has unsynced changes that cannot be merged; kept');
    return false;
  }
  if (options.late?.()) return false;
  options.copying?.(true);
  try {
    await native.save(merged);
    const meta = (await native.loadMeta(SYNC)) as { acks?: Acks } | null;
    if (meta) await native.saveMeta(SYNC, { ...meta, acks: newerAcks(meta.acks ?? {}, leftAcks) });
  } finally {
    options.copying?.(false);
  }
  keepOlderCopy(false);
  forgetFailures();
  return true;
}

/**
 * The older copy kept in the WebView's storage, as a save keeps it, for Settings to bring in
 * through the import path; null when there is none.
 */
export async function olderCopy(name = 'pecklist'): Promise<WorkspaceFile | null> {
  if ((await webViewDatabases(name)).length === 0) return null;
  const left = (await createIndexedDbStorage(name).load()) as WorkspaceFile | null;
  return left && asSaved(left);
}

/**
 * The account the older copy last synced with, from the sync state kept beside it; null when it
 * never signed in (a workspace on this phone alone) or there is no copy. Settings asks before
 * bringing another account's tasks into this one (bug sweep, PL-070 review).
 */
export async function olderCopyAccount(name = 'pecklist'): Promise<string | null> {
  if ((await webViewDatabases(name)).length === 0) return null;
  const meta = (await createIndexedDbStorage(name).loadMeta(SYNC)) as { account?: unknown } | null;
  return typeof meta?.account === 'string' ? meta.account : null;
}

/** Deletes the older copy (attached files stay), and the flag once it is gone. True when gone. */
export async function deleteOlderCopy(name = 'pecklist'): Promise<boolean> {
  await dropWebView(name);
  if ((await webViewDatabases(name)).length > 0) return false;
  keepOlderCopy(false);
  return true;
}

/** The native store, whose wipe (signing out) takes a kept IndexedDB copy with it (audit W1). */
function nativeStorage(store: NativeStoreCalls, name: string): StorageAdapter {
  const storage = createNativeStorage(store);
  return {
    ...storage,
    async wipe() {
      await storage.wipe();
      await dropWebView(name);
      keepOlderCopy(false);
    },
  };
}

/** `work`, tried again after a moment when it fails, up to `tries` times in all. */
async function retrying<T>(work: () => Promise<T>, tries: number): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}

/**
 * The native store to run on this start, and whether the WebView's copy may be deleted once the
 * app does; null to stay on IndexedDB (the move failed and runs again next start). Never null for
 * an origin that has moved: with the native store failing, the app's load says so.
 */
export async function openNativeStorage(
  store: NativeStoreCalls,
  options: MoveOptions = {},
): Promise<{ storage: StorageAdapter; dropWebView: boolean } | null> {
  const name = options.databaseName ?? 'pecklist';
  let moved = movedHere();
  const native = () => nativeStorage(store, name);
  try {
    if ((await retrying(() => store.get(MOVED), moved ? 3 : 1)) === null) {
      const migrating = (await store.get(MIGRATING)) !== null;
      const { header } = await store.load(null, 0);
      if (header === null || migrating) {
        // A copy cut off before its marker: it may be partial, so it goes and the copy runs again.
        if (migrating || header !== null) await store.wipe();
        if (await copyWebView(store, options)) return { storage: native(), dropWebView: true };
        return moved ? { storage: native(), dropWebView: false } : null;
      }
      // A native workspace this origin already has, never one being copied: it is the one.
      options.decided?.();
      await store.put([[MOVED, 'true']]);
    } else {
      options.decided?.();
    }
    rememberMoved();
    moved = true;
    const drop = await takeInLeftover(store, options).catch((error: unknown) => {
      console.warn('Could not look at the web view’s storage left behind; next start', error);
      return false;
    });
    return { storage: native(), dropWebView: drop };
  } catch (error) {
    console.warn('The app’s own storage did not answer', error);
    return moved ? { storage: native(), dropWebView: false } : null;
  }
}

/** {@link openNativeStorage}, then the WebView's copy deleted when it may be (tests, no time limit). */
export async function moveToNative(
  store: NativeStoreCalls,
  options: MoveOptions = {},
): Promise<StorageAdapter | null> {
  const opened = await openNativeStorage(store, options);
  if (opened?.dropWebView && !options.late?.())
    await dropWebView(options.databaseName ?? 'pecklist');
  return opened?.storage ?? null;
}

/**
 * {@link openNativeStorage}, but the app never waits long for a first move: after `limit` ms it
 * starts on IndexedDB, unless a copy is under way, which gets until `copyLimit`. A move that runs
 * past that never sets its marker. Once the marker is being written (or was found), the outcome
 * is the native store, and the app waits for it. An origin that has moved has no time limit at all.
 * The WebView's copy is deleted only when the app was handed the native store.
 */
export function moveToNativeWithin(
  store: NativeStoreCalls,
  limit = 3_000,
  copyLimit = 30_000,
  databaseName = 'pecklist',
): Promise<StorageAdapter | null> {
  if (movedHere()) {
    return openNativeStorage(store, { databaseName }).then((opened) => {
      if (opened?.dropWebView) void dropWebView(databaseName);
      return opened?.storage ?? nativeStorage(store, databaseName);
    });
  }
  let late = false;
  let copying = false;
  let decided = false;
  return new Promise((resolve) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const startWithout = () => {
      if (decided) return;
      late = true;
      timers.forEach(clearTimeout);
      resolve(null);
    };
    timers.push(
      setTimeout(() => {
        if (copying) timers.push(setTimeout(startWithout, copyLimit - limit));
        else startWithout();
      }, limit),
    );
    void openNativeStorage(store, {
      databaseName,
      late: () => late,
      copying: (on) => (copying = on),
      decided: () => (decided = true),
    }).then((opened) => {
      if (late) return;
      timers.forEach(clearTimeout);
      resolve(opened?.storage ?? null);
      if (opened?.dropWebView) void dropWebView(databaseName);
    });
  });
}

let picked: StorageAdapter | null = null;

/** The storage {@link prepareNativeStorage} picked: the native store, or null for IndexedDB. */
export function pickedStorage(): StorageAdapter | null {
  return picked;
}

/**
 * In the Android app with a shell that has the native store (api 16), moves this origin's data
 * there if it has not yet, and picks it. Elsewhere (a browser, the PWA, an older APK) nothing
 * changes. Never rejects.
 */
export async function prepareNativeStorage(): Promise<void> {
  try {
    const shell = nativeShell();
    if (!shell?.store) return;
    const info = await shell.info();
    if (info.api < NATIVE_STORE_API) return;
    picked = await moveToNativeWithin(shell.store);
  } catch (error) {
    console.warn('Could not reach the app’s own storage', error);
  }
}
