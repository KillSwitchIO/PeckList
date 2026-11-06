import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import type { SyncTransport } from '../../ports/sync.ts';
import type { WorkspaceStore } from '../store/workspaceStore.ts';
import { createSyncEngine, type SyncEngine, type SyncState } from './syncEngine.ts';

export const SyncContext = createContext<SyncEngine | null>(null);

export function useSyncEngine(): SyncEngine {
  const engine = useContext(SyncContext);
  if (!engine) throw new Error('useSyncEngine must be used inside SyncProvider');
  return engine;
}

export function useSyncState<T>(selector: (state: SyncState) => T): T {
  return useStore(useSyncEngine(), selector);
}

/**
 * Whether this device knows what the server knows, so it may clean up. Moving something to the
 * trash from a stale copy would write over what another device has already done (PL-130): after
 * Empty trash elsewhere, that left erased tasks in the trash as blank rows.
 */
export function mayCleanUp(state: Pick<SyncState, 'phase' | 'lastSynced'>): boolean {
  return state.phase === 'standalone' || (state.phase === 'ready' && state.lastSynced !== null);
}

/** A transport for builds without a server: every call says there is none. */
export const NO_SERVER: SyncTransport = {
  info: () => Promise.resolve(null),
  me: () => Promise.resolve(null),
  login: () => Promise.resolve({ kind: 'invalid' }),
  logout: () => Promise.resolve(undefined),
  changePassword: () => Promise.resolve({ kind: 'wrong-password' }),
  sync: () => Promise.reject(new Error('no server')),
};

/** An engine that finds no server and stays out of the way (tests, plain PWA hosting). */
export function standaloneSync(workspace: WorkspaceStore): SyncEngine {
  return createSyncEngine({ transport: NO_SERVER, workspace, storage: createMemoryStorage() });
}
