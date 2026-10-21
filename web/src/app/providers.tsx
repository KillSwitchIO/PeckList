import { useState, type ReactNode } from 'react';
import { StatusGate } from './StatusGate.tsx';
import { StoreProvider } from './store/StoreProvider.tsx';
import type { WorkspaceStore } from './store/workspaceStore.ts';
import { standaloneSync } from './sync/syncContext.ts';
import type { SyncEngine } from './sync/syncEngine.ts';
import { SyncProvider } from './sync/SyncProvider.tsx';
import { ThemeModeProvider } from './theme/ThemeModeProvider.tsx';

/**
 * Providers shared by the real app and tests. Without a `sync` engine the app runs standalone
 * (no server), as a plain PWA does.
 */
export function AppProviders({
  store,
  sync,
  children,
}: {
  store: WorkspaceStore;
  sync?: SyncEngine;
  children: ReactNode;
}) {
  const [engine] = useState(() => sync ?? standaloneSync(store));
  return (
    <ThemeModeProvider>
      <StoreProvider store={store}>
        <StatusGate>
          <SyncProvider engine={engine}>{children}</SyncProvider>
        </StatusGate>
      </StoreProvider>
    </ThemeModeProvider>
  );
}
