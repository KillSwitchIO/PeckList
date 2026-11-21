import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { effectivePalette, paletteTint } from '../../core/paletteSettings.ts';
import { updateSettings } from '../../core/settings.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { setDisplayPreferences } from '../format.ts';
import { applyLanguageChoice, catalogOf, shownLanguage } from '../i18n/language.ts';
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
  const overrides = effectivePalette(workspace);
  const key = JSON.stringify(overrides);
  const tint = paletteTint(workspace);
  // The language picked in Settings, synced (PL-148), or automatic. Once its catalog is in, the
  // app below renders again from the top, so no string or date is left in the old language: a
  // change of language is rare and deliberate, and the stores and the address outlive it.
  const choice = settings?.language ?? null;
  const [shown, setShown] = useState(shownLanguage);
  useEffect(() => {
    let live = true;
    void applyLanguageChoice(choice).then(() => {
      if (live) setShown(shownLanguage());
    });
    return () => {
      live = false;
    };
  }, [choice]);
  const catalog = catalogOf(shown);
  // A new theme object when the clock changes too, so everything showing a time renders again.
  const theme = useMemo(
    () => ({
      ...createAppTheme(resolved, JSON.parse(key) as Record<string, string>, tint, catalog),
      display,
    }),
    [resolved, key, tint, display, catalog],
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
      <ThemeProvider theme={theme}>
        {/* The page itself (background, text, scrollbars) follows this theme too, not only the
            components: without it the page kept the mode it opened with until a reload. */}
        <CssBaseline enableColorScheme />
        <Fragment key={shown}>{children}</Fragment>
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}
