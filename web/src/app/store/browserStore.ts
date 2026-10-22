// Composition root for the browser: wires the real adapters into the store and the sync engine.
import { createAjvValidator } from '../../adapters/ajv-validator.ts';
import { createHttpSync } from '../../adapters/http-sync.ts';
import { createIndexedDbStorage } from '../../adapters/indexeddb-storage.ts';
import { createLocalJournal } from '../../adapters/local-journal.ts';
import { createUlidGenerator } from '../../adapters/ulid-ids.ts';
import { createSyncEngine, type SyncEngine } from '../sync/syncEngine.ts';
import { tabNodeId } from './device.ts';
import { createWorkspaceStore, type WorkspaceStore } from './workspaceStore.ts';

const CHANNEL = 'punchlist';

/** Run `work` holding a lock shared by every tab (Web Locks), or directly where there are none. */
const lock =
  (name: string) =>
  <T>(work: () => Promise<T>): Promise<T> =>
    navigator.locks ? navigator.locks.request(name, work) : work();

export function createBrowserApp(): { store: WorkspaceStore; sync: SyncEngine } {
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  void navigator.storage?.persist?.();
  const storage = createIndexedDbStorage();
  const node = tabNodeId();
  const store = createWorkspaceStore({
    storage,
    validator: createAjvValidator(),
    ids: createUlidGenerator(),
    node,
    withLock: lock('punchlist-save'),
    notify: () => channel?.postMessage('saved'),
    journal: createLocalJournal(),
  });
  // The server that served this page, if it is a Punchlist server (a static host is not).
  const sync = createSyncEngine({
    transport: createHttpSync('', undefined, node),
    device: node,
    workspace: store,
    storage,
    withLock: lock('punchlist-sync'),
  });
  return { store, sync };
}
