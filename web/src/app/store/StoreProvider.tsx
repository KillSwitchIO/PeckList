import { useEffect, type ReactNode } from 'react';
import { StoreContext } from './hooks.ts';
import type { WorkspaceStore } from './workspaceStore.ts';

/**
 * Makes the store available, initializes it, and saves before the page goes away. Other tabs'
 * saves reach it through the composition root (browserStore), on the channel it saves on.
 */
export function StoreProvider({ store, children }: { store: WorkspaceStore; children: ReactNode }) {
  useEffect(() => {
    void store.getState().init();
    // The page may be going away: note unsaved changes synchronously, then start the save.
    const flush = () => {
      store.getState().journal();
      void store.getState().flush();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
