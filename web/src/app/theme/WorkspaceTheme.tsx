import { ThemeProvider, useMediaQuery } from '@mui/material';
import { useEffect, useMemo, type ReactNode } from 'react';
import { paletteOverrides } from '../../core/paletteSettings.ts';
import { updateSettings } from '../../core/settings.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { setDisplayPreferences } from '../format.ts';
import { createAppTheme } from './theme.ts';
import {
  nextThemeMode,
  rememberThemeMode,
  takeBrowserMode,
  ThemeModeContext,
  type ThemeModeValue,
} from './themeMode.ts';

/**
 * The theme from the user's settings (PL-018, PL-025): their theme mode and colors, which sync.
 * The outer theme (before the workspace opens) uses the mode this browser remembers and the
 * default colors; once the workspace is open this one takes over, and every change on the
 * Settings page shows at once.
 */
export function WorkspaceTheme({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const settings = workspace.entities.settings[0];
  const mode = settings?.themeMode ?? 'system';
  // Clock and week start for every date shown below (set before they render).
  setDisplayPreferences(settings ?? {});
  const display = `${settings?.clockFormat ?? '12h'}/${settings?.weekStart ?? 0}`;
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  const overrides = paletteOverrides(workspace);
  const key = JSON.stringify(overrides);
  // A new theme object when the clock changes too, so everything showing a time renders again.
  const theme = useMemo(
    () => ({ ...createAppTheme(resolved, JSON.parse(key) as Record<string, string>), display }),
    [resolved, key, display],
  );
  // A light or dark choice made in this browser before settings synced comes along, once.
  useEffect(() => {
    const picked = takeBrowserMode();
    if (picked) apply((ctx, ws) => updateSettings(ctx, ws, { themeMode: picked }));
  }, [apply]);
  // The next start paints with this mode before the workspace has loaded.
  useEffect(() => rememberThemeMode(mode), [mode]);

  const value = useMemo<ThemeModeValue>(() => {
    const setMode = (next: ThemeModeValue['mode']) =>
      apply((ctx, ws) => updateSettings(ctx, ws, { themeMode: next }));
    return { mode, resolved, setMode, cycleMode: () => setMode(nextThemeMode(mode)) };
  }, [apply, mode, resolved]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  );
}
