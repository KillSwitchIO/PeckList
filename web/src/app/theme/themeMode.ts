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

export const ThemeModeContext = createContext<ThemeModeValue | null>(null);

export function useThemeMode(): ThemeModeValue {
  const value = useContext(ThemeModeContext);
  if (!value) throw new Error('useThemeMode must be used inside ThemeModeProvider');
  return value;
}
