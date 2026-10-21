import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { AppProviders } from './providers.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { AppRoutes } from './routes.tsx';
import { createBrowserStore } from './store/browserStore.ts';

export function App() {
  const [store] = useState(createBrowserStore);
  return (
    <>
      <AppProviders store={store}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProviders>
      <UpdatePrompt />
    </>
  );
}
