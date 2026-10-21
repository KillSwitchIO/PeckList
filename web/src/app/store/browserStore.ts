// Composition root for the browser: wires the real adapters into the store.
import { createAjvValidator } from '../../adapters/ajv-validator.ts';
import { createIndexedDbStorage } from '../../adapters/indexeddb-storage.ts';
import { createUlidGenerator } from '../../adapters/ulid-ids.ts';
import { tabNodeId } from './device.ts';
import { createWorkspaceStore, type WorkspaceStore } from './workspaceStore.ts';

const CHANNEL = 'punchlist';

export function createBrowserStore(): WorkspaceStore {
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  void navigator.storage?.persist?.();
  return createWorkspaceStore({
    storage: createIndexedDbStorage(),
    validator: createAjvValidator(),
    ids: createUlidGenerator(),
    node: tabNodeId(),
    withLock: (run) => (navigator.locks ? navigator.locks.request('punchlist-save', run) : run()),
    notify: () => channel?.postMessage('saved'),
  });
}
