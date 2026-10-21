import { createTheme, type Theme } from '@mui/material/styles';
import { buildPalette, type ModePalette } from '../../core/palette.ts';

declare module '@mui/material/styles' {
  interface Theme {
    punchlist: ModePalette;
  }
  interface ThemeOptions {
    punchlist?: ModePalette;
  }
}

/** MUI theme built from the Punchlist color tokens. Components read `theme.punchlist` for meaning-bearing colors. */
export function createAppTheme(
  mode: 'light' | 'dark',
  overrides: Record<string, string> = {},
): Theme {
  const p = buildPalette(mode, overrides);
  return createTheme({
    punchlist: p,
    palette: {
      mode,
      primary: { main: p.accent.fill, contrastText: p.accent.on },
      background: { default: p.background, paper: p.surface },
      text: { primary: p.text, secondary: p.textMuted },
      divider: p.outline,
      error: { main: p.dateState.late },
      warning: { main: p.dateState.slipped },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      h1: { fontSize: '1.5rem', fontWeight: 600 },
      h2: { fontSize: '1.25rem', fontWeight: 600 },
    },
    components: {
      // Sentence-case labels read calmer than MUI's default all caps.
      MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: 'none' } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none' } } },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'inherit' },
        styleOverrides: {
          root: { backgroundColor: p.background, borderBottom: `1px solid ${p.outline}` },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { backgroundColor: p.surfaceVariant, borderRight: `1px solid ${p.outline}` },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            marginInline: 8,
            '&.Mui-selected': { backgroundColor: p.accentContainer },
            '&.Mui-selected:hover': { backgroundColor: p.accentContainer },
          },
        },
      },
      MuiBottomNavigation: {
        styleOverrides: {
          root: { backgroundColor: p.surfaceVariant, borderTop: `1px solid ${p.outline}` },
        },
      },
    },
  });
}
