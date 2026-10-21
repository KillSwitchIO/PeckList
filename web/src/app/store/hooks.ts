import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { WorkspaceFile } from '../../core/types.ts';
import type { WorkspaceState, WorkspaceStore } from './workspaceStore.ts';

export const StoreContext = createContext<WorkspaceStore | null>(null);

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useWorkspaceStore must be used inside StoreProvider');
  return store;
}

export function useStoreState<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(useWorkspaceStore(), selector);
}

/** The loaded workspace. Only call from components rendered once the store is ready. */
export function useWorkspace(): WorkspaceFile {
  const workspace = useStoreState((state) => state.workspace);
  if (!workspace) throw new Error('workspace is not loaded');
  return workspace;
}

export function useApply(): WorkspaceState['apply'] {
  return useStoreState((state) => state.apply);
}
