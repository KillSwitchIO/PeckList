// Keyboard shortcuts (spec: PL-023): one registry for the keys and the "?" list. Shortcuts are
// plain keys (or G then a key) with no Ctrl, Alt or Cmd, and never fire while typing or while a
// dialog is open, so they stay clear of the browser's own shortcuts.

import type { MessageKey } from '../i18n/i18n.ts';

export type ShortcutAction =
  | { kind: 'go'; path: string }
  | { kind: 'addTask' }
  | { kind: 'search' }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'edit' }
  | { kind: 'complete' }
  | { kind: 'delete' }
  | { kind: 'help' };

export interface Shortcut {
  /** Keys pressed in turn, as `KeyboardEvent.key` (lower case letters) */
  keys: readonly string[];
  /** How the list shows the keys */
  label: string;
  description: MessageKey;
  group: 'general' | 'go' | 'task';
  action: ShortcutAction;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    keys: ['q'],
    label: 'Q',
    description: 'shortcut.addTask',
    group: 'general',
    action: { kind: 'addTask' },
  },
  {
    keys: ['/'],
    label: '/',
    description: 'shortcut.search',
    group: 'general',
    action: { kind: 'search' },
  },
  {
    keys: ['?'],
    label: '?',
    description: 'shortcut.help',
    group: 'general',
    action: { kind: 'help' },
  },
  {
    keys: ['g', 't'],
    label: 'G T',
    description: 'nav.today',
    group: 'go',
    action: { kind: 'go', path: '/today' },
  },
  {
    keys: ['g', 'i'],
    label: 'G I',
    description: 'nav.inbox',
    group: 'go',
    action: { kind: 'go', path: '/inbox' },
  },
  {
    keys: ['g', 'n'],
    label: 'G N',
    description: 'nav.upcoming',
    group: 'go',
    action: { kind: 'go', path: '/upcoming' },
  },
  {
    keys: ['g', 'a'],
    label: 'G A',
    description: 'nav.all',
    group: 'go',
    action: { kind: 'go', path: '/all' },
  },
  {
    keys: ['g', 'c'],
    label: 'G C',
    description: 'nav.calendar',
    group: 'go',
    action: { kind: 'go', path: '/calendar' },
  },
  {
    keys: ['g', 's'],
    label: 'G S',
    description: 'nav.settings',
    group: 'go',
    action: { kind: 'go', path: '/settings' },
  },
  {
    keys: ['j'],
    label: 'J',
    description: 'shortcut.next',
    group: 'task',
    action: { kind: 'next' },
  },
  {
    keys: ['k'],
    label: 'K',
    description: 'shortcut.previous',
    group: 'task',
    action: { kind: 'previous' },
  },
  {
    keys: ['e'],
    label: 'E',
    description: 'shortcut.edit',
    group: 'task',
    action: { kind: 'edit' },
  },
  {
    keys: [' '],
    label: 'Space',
    description: 'shortcut.complete',
    group: 'task',
    action: { kind: 'complete' },
  },
  {
    keys: ['delete'],
    label: 'Delete',
    description: 'shortcut.delete',
    group: 'task',
    action: { kind: 'delete' },
  },
];

/** Keys that start a longer shortcut (wait for the next key). */
const PREFIXES = new Set(
  SHORTCUTS.filter((each) => each.keys.length > 1).map((each) => each.keys[0]),
);

/**
 * The shortcut for the keys pressed so far, `'pending'` when they start one (G), or null.
 * `pressed` holds the earlier keys of a sequence and the new one last.
 */
export function matchShortcut(pressed: readonly string[]): Shortcut | 'pending' | null {
  const found = SHORTCUTS.find(
    (each) =>
      each.keys.length === pressed.length && each.keys.every((key, i) => key === pressed[i]),
  );
  if (found) return found;
  if (pressed.length === 1 && PREFIXES.has(pressed[0]!)) return 'pending';
  return null;
}
