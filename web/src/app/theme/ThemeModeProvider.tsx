import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { useMemo, useState, type ReactNode } from 'react';
import { createAppTheme } from './theme.ts';
import {
  nextThemeMode,
  ThemeModeContext,
  type ThemeMode,
  type ThemeModeValue,
} from './themeMode.ts';

const STORAGE_KEY = 'punchlist.themeMode';

function readStoredMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

// The theme mode moves into the workspace Settings entity with the domain store (PL-008).
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  const theme = useMemo(() => createAppTheme(resolved), [resolved]);

  const value = useMemo<ThemeModeValue>(() => {
    const setMode = (next: ThemeMode) => {
      setModeState(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // storage unavailable (private mode): keep the in-memory choice
      }
    };
    return {
      mode,
      resolved,
      setMode,
      cycleMode: () => setMode(nextThemeMode(mode)),
    };
  }, [mode, resolved]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}
