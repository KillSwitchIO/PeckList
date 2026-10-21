import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { AppProviders } from './providers.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { AppRoutes } from './routes.tsx';
import { createBrowserApp } from './store/browserStore.ts';

export function App() {
  const [{ store, sync }] = useState(createBrowserApp);
  return (
    <>
      <AppProviders store={store} sync={sync}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProviders>
      <UpdatePrompt />
    </>
  );
}
