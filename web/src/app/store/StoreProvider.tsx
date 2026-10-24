import { useEffect, type ReactNode } from 'react';
import { StoreContext } from './hooks.ts';
import type { WorkspaceStore } from './workspaceStore.ts';

/** Makes the store available, initializes it, and keeps it in step with other tabs. */
export function StoreProvider({
  store,
  channelName = 'punchlist',
  children,
}: {
  store: WorkspaceStore;
  channelName?: string;
  children: ReactNode;
}) {
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
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName);
    if (channel) channel.onmessage = () => void store.getState().reloadFromStorage();
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      channel?.close();
    };
  }, [store, channelName]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
