import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { AppProviders } from './providers.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { AppRoutes } from './routes.tsx';
import { createBrowserApp } from './store/browserStore.ts';
import { ViewAsContext } from './store/viewAs.ts';
import { ViewAsBanner } from './sync/ViewAsBanner.tsx';

export function App() {
  const [{ store, sync, viewAs }] = useState(createBrowserApp);
  return (
    <ViewAsContext.Provider value={viewAs}>
      <AppProviders store={store} sync={sync}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        {viewAs && <ViewAsBanner view={viewAs} />}
        <UpdatePrompt />
      </AppProviders>
    </ViewAsContext.Provider>
  );
}
