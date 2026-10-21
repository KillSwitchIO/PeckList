import { useEffect, type ReactNode } from 'react';
import { AuthPages } from './AuthPages.tsx';
import { SyncContext, useSyncState } from './syncContext.ts';
import type { SyncEngine } from './syncEngine.ts';

/**
 * Starts the sync engine once the workspace is open and shows the sign-in or password pages when
 * the server needs them. Without a server (or while checking) the app shows straight away: it is
 * local-first.
 */
export function SyncProvider({ engine, children }: { engine: SyncEngine; children: ReactNode }) {
  useEffect(() => {
    void engine.getState().start();
    return () => engine.getState().stop();
  }, [engine]);

  return (
    <SyncContext.Provider value={engine}>
      <AuthGate>{children}</AuthGate>
    </SyncContext.Provider>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const phase = useSyncState((state) => state.phase);
  if (phase === 'signed-out' || phase === 'password-change') return <AuthPages phase={phase} />;
  return <>{children}</>;
}
