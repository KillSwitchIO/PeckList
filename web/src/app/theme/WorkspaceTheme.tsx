import { ThemeProvider } from '@mui/material';
import { useMemo, type ReactNode } from 'react';
import { paletteOverrides } from '../../core/paletteSettings.ts';
import { useWorkspace } from '../store/hooks.ts';
import { createAppTheme } from './theme.ts';
import { useThemeMode } from './themeMode.ts';

/**
 * The theme with the user's own colors (settings.palette, PL-018). The outer theme (before the
 * workspace opens) uses the defaults; once it is open this one takes over, and every change in
 * the palette editor shows at once.
 */
export function WorkspaceTheme({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const { resolved } = useThemeMode();
  const overrides = paletteOverrides(workspace);
  const key = JSON.stringify(overrides);
  const theme = useMemo(
    () => createAppTheme(resolved, JSON.parse(key) as Record<string, string>),
    [resolved, key],
  );
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
