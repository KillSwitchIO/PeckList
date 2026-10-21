import { BrowserRouter } from 'react-router';
import { AppProviders } from './providers.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import { AppRoutes } from './routes.tsx';

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <UpdatePrompt />
    </AppProviders>
  );
}
