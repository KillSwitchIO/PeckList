// First: moves settings kept under the old name before any other module reads them (PL-127).
import { moveDatabasesWithin } from './app/store/renameStorage.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { preferredLanguage, setLocaleWithin } from './app/i18n/i18n.ts';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

// The workspace, unsynced changes and files move to the new databases before anything opens them.
// Never for long: a slow disk or a deletion held up by another tab must not leave a blank page.
// The browser's language loads alongside (its own chunk, unless it is English), so the first
// paint is already in it; past the same 3 s, it starts in English. Neither rejects.
const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
void Promise.allSettled([
  moveDatabasesWithin(),
  setLocaleWithin(preferredLanguage(languages)),
]).finally(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
