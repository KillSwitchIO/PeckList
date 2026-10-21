import type { WorkspaceFile } from '../core/types.ts';
import type { StorageAdapter } from '../ports/storage.ts';

/** In-memory storage for tests and for running without persistence. */
export function createMemoryStorage(): StorageAdapter {
  let stored: string | null = null;
  const backups = new Map<string, string>();
  return {
    kind: 'memory',
    load: () => Promise.resolve(stored === null ? null : (JSON.parse(stored) as unknown)),
    save: (workspace: WorkspaceFile) => {
      stored = JSON.stringify(workspace);
      return Promise.resolve();
    },
    clear: () => {
      stored = null;
      return Promise.resolve();
    },
    backup: (name: string, document: unknown) => {
      backups.set(name, JSON.stringify(document));
      return Promise.resolve();
    },
    loadBackup: (name: string) => {
      const text = backups.get(name);
      return Promise.resolve(text === undefined ? null : (JSON.parse(text) as unknown));
    },
  };
}
