import type { Journal } from '../ports/journal.ts';

/** The Journal port on localStorage (synchronous, survives the page). Fails quietly when blocked. */
export function createLocalJournal(key = 'punchlist.journal'): Journal {
  return {
    write(text) {
      try {
        localStorage.setItem(key, text);
      } catch {
        // Full or blocked: the regular save is still on its way.
      }
    },
    read() {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}
