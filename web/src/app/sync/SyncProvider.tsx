import { useEffect, type ReactNode } from 'react';
import { DemoBanner } from '../demo/DemoBanner.tsx';
import { useViewAs } from '../store/viewAs.ts';
import { AuthPages } from './AuthPages.tsx';
import { JoinQuestion } from './JoinQuestion.tsx';
import { ViewEnded } from './ViewAsBanner.tsx';
import { SyncContext, useSyncState } from './syncContext.ts';
import type { SyncEngine } from './syncEngine.ts';
import { startUsage, stopUsage } from '../telemetry/usage.ts';

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
      <UsageCounting />
      {/* Over the sign-in pages and the app alike (PL-117). */}
      <DemoBanner />
    </SyncContext.Provider>
  );
}

/** Usage counts (PL-116) for a signed-in session, when the server and the person allow them. */
function UsageCounting() {
  const phase = useSyncState((state) => state.phase);
  const transport = useSyncState((state) => state.transport);
  const accountId = useSyncState((state) => state.account?.id);
  useEffect(() => {
    if (phase !== 'ready' || !accountId) return;
    void startUsage(transport);
    return () => stopUsage();
  }, [phase, transport, accountId]);
  return null;
}

function AuthGate({ children }: { children: ReactNode }) {
  const phase = useSyncState((state) => state.phase);
  // Viewing as someone: no sign-in here, only the way back.
  const viewAs = useViewAs();
  if (viewAs && phase === 'signed-out') return <ViewEnded />;
  if (phase === 'signed-out' || phase === 'password-change') return <AuthPages phase={phase} />;
  if (phase === 'join-question') return <JoinQuestion />;
  return <>{children}</>;
}
