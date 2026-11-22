// First: moves settings kept under the old name before any other module reads them (PL-127).
import { moveDatabasesWithin } from './app/store/renameStorage.ts';
import { prepareNativeStorage } from './app/store/nativeMigration.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { applyLanguageChoice, rememberedChoice } from './app/i18n/language.ts';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

// The workspace, unsynced changes and files move to the new databases before anything opens them.
// Never for long: a slow disk or a deletion held up by another tab must not leave a blank page.
// The language loads alongside (the one this device last used, else the browser's; its own chunk
// unless it is English), so the first paint is already in it; past the same 3 s, it starts in
// English. Neither rejects. In the Android app, the data then moves to the app's own storage
// (PL-070), once, also bounded.
void Promise.allSettled([
  moveDatabasesWithin().then(prepareNativeStorage),
  applyLanguageChoice(rememberedChoice(), 3_000),
]).finally(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
