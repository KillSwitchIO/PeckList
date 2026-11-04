import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router';
import { BackgroundCheckPrompt } from './native/BackgroundCheck.tsx';
import { NativeFirstRun } from './native/FirstRun.tsx';
import { NotificationOpen } from './native/NotificationOpen.tsx';
import { installBackHandler } from './native/back.ts';
import { forgetServiceWorker, isBundledApp, nativeShell } from './native/shell.ts';
import { AppProviders } from './providers.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { preloadEditor } from './editor/preloadEditor.ts';
import { preloadPages } from './lazyPages.ts';
import { loadSymbolCatalog } from './lists/listSymbols.ts';
import { AppRoutes } from './routes.tsx';
import { CrashBoundary, NativeCrashOffer } from './telemetry/CrashBoundary.tsx';
import { createBrowserApp } from './store/browserStore.ts';
import { ViewAsContext } from './store/viewAs.ts';
import { ViewAsBanner } from './sync/ViewAsBanner.tsx';

const bundled = isBundledApp();
if (bundled) forgetServiceWorker();
if (nativeShell()) installBackHandler();

export function App() {
  const [{ store, sync, viewAs }] = useState(createBrowserApp);
  // Once the lists are up and the page is idle, fetch what loads on first use (R-FB-94): the
  // pages split off the first load, and the notes editor, so the first task opened is quick too.
  useEffect(() => {
    const later = (work: () => void) =>
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(work, { timeout: 5000 })
        : setTimeout(work, 2000);
    later(() => {
      void preloadEditor();
      void preloadPages();
      void loadSymbolCatalog();
    });
  }, []);
  return (
    <ViewAsContext.Provider value={viewAs}>
      <AppProviders store={store} sync={sync}>
        <BrowserRouter>
          <CrashBoundary>
            <AppRoutes />
          </CrashBoundary>
          <NativeFirstRun />
          <NativeCrashOffer />
          <NotificationOpen />
          <BackgroundCheckPrompt />
        </BrowserRouter>
        {viewAs && <ViewAsBanner view={viewAs} />}
        {!bundled && <UpdatePrompt />}
      </AppProviders>
    </ViewAsContext.Provider>
  );
}
