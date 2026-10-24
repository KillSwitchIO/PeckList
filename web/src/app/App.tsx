import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { NativeFirstRun } from './native/FirstRun.tsx';
import { NotificationOpen } from './native/NotificationOpen.tsx';
import { installBackHandler } from './native/back.ts';
import { forgetServiceWorker, isBundledApp, nativeShell } from './native/shell.ts';
import { AppProviders } from './providers.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { AppRoutes } from './routes.tsx';
import { createBrowserApp } from './store/browserStore.ts';
import { ViewAsContext } from './store/viewAs.ts';
import { ViewAsBanner } from './sync/ViewAsBanner.tsx';

const bundled = isBundledApp();
if (bundled) forgetServiceWorker();
if (nativeShell()) installBackHandler();

export function App() {
  const [{ store, sync, viewAs }] = useState(createBrowserApp);
  return (
    <ViewAsContext.Provider value={viewAs}>
      <AppProviders store={store} sync={sync}>
        <BrowserRouter>
          <AppRoutes />
          <NativeFirstRun />
          <NotificationOpen />
        </BrowserRouter>
        {viewAs && <ViewAsBanner view={viewAs} />}
        {!bundled && <UpdatePrompt />}
      </AppProviders>
    </ViewAsContext.Provider>
  );
}
