// First: moves settings kept under the old name before any other module reads them (PL-127).
import { moveDatabases } from './app/store/renameStorage.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { setLocale } from './app/i18n/i18n.ts';

setLocale(navigator.language);

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

// The workspace, unsynced changes and files move to the new databases before anything opens them.
void moveDatabases().finally(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
