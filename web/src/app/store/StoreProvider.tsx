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
    // Kept for the back button, the page stops where it stands. A save started now can be given the
    // lock all tabs share just as it stops, and Firefox then holds that lock until it drops the
    // page: nothing saves, in any tab. The note is enough; a new page, or this one's return, saves.
    let kept = false;
    const onPageHide = (event: PageTransitionEvent) => {
      kept = event.persisted;
      if (kept) store.getState().journal();
      else flush();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      kept = false;
      if (event.persisted) void store.getState().flush();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden' && !kept) flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
