import type { ReactNode } from 'react';
import { StatusGate } from './StatusGate.tsx';
import { StoreProvider } from './store/StoreProvider.tsx';
import type { WorkspaceStore } from './store/workspaceStore.ts';
import { ThemeModeProvider } from './theme/ThemeModeProvider.tsx';

/** Providers shared by the real app and tests. */
export function AppProviders({ store, children }: { store: WorkspaceStore; children: ReactNode }) {
  return (
    <ThemeModeProvider>
      <StoreProvider store={store}>
        <StatusGate>{children}</StatusGate>
      </StoreProvider>
    </ThemeModeProvider>
  );
}
