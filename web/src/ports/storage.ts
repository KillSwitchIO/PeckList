import type { WorkspaceFile } from '../core/types.ts';

/**
 * Persists the user's workspace document. Implementations: IndexedDB, linked file on disk,
 * server sync, native filesystem. Every implementation must pass the storage contract suite
 * (src/adapters/storage.contract.ts).
 */
export interface StorageAdapter {
  readonly kind: string;
  /** The stored document as raw parsed JSON (not yet version-checked), or null if empty. */
  load(): Promise<unknown>;
  save(workspace: WorkspaceFile): Promise<void>;
  clear(): Promise<void>;
  /** Keep a copy of a document under a name (before an upgrade), apart from the workspace. */
  backup(name: string, document: unknown): Promise<void>;
  /** A copy kept by `backup`, or null. */
  loadBackup(name: string): Promise<unknown>;
  /**
   * Device-local state that is not part of the workspace (sync progress), as JSON values by key.
   * Never exported or synced. `null` when nothing was saved under the key.
   */
  loadMeta(key: string): Promise<unknown>;
  saveMeta(key: string, value: unknown): Promise<void>;
}
