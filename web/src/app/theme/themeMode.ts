import { createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeModeValue {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
}

export const THEME_MODE_ORDER: readonly ThemeMode[] = ['system', 'light', 'dark'];

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return (
    THEME_MODE_ORDER[(THEME_MODE_ORDER.indexOf(mode) + 1) % THEME_MODE_ORDER.length] ?? 'system'
  );
}

const STORAGE_KEY = 'punchlist.themeMode';
const MOVED_KEY = 'punchlist.themeMode.moved';

/** The mode this browser remembers (what to paint before the workspace opens). */
export function readStoredMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Remember a mode in this browser, so the next start paints with it before data loads. */
export function rememberThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage unavailable (private mode): the workspace still has it
  }
}

/**
 * The mode picked in this browser before it moved into the workspace settings, once: later
 * starts return null (the workspace is the source from then on).
 */
export function takeBrowserMode(): ThemeMode | null {
  try {
    if (localStorage.getItem(MOVED_KEY)) return null;
    localStorage.setItem(MOVED_KEY, '1');
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

export const ThemeModeContext = createContext<ThemeModeValue | null>(null);

export function useThemeMode(): ThemeModeValue {
  const value = useContext(ThemeModeContext);
  if (!value) throw new Error('useThemeMode must be used inside ThemeModeProvider');
  return value;
}
