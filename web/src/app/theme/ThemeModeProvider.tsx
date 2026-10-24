import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { useMemo, useState, type ReactNode } from 'react';
import { createAppTheme } from './theme.ts';
import {
  nextThemeMode,
  readStoredMode,
  rememberThemeMode,
  ThemeModeContext,
  type ThemeMode,
  type ThemeModeValue,
} from './themeMode.ts';

// Before the workspace opens: the mode this browser remembers. The open workspace's settings
// take over from there (WorkspaceTheme).
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  const theme = useMemo(() => createAppTheme(resolved), [resolved]);

  const value = useMemo<ThemeModeValue>(() => {
    const setMode = (next: ThemeMode) => {
      setModeState(next);
      rememberThemeMode(next);
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
