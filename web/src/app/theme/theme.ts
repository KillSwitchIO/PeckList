import { createTheme, type Theme } from '@mui/material/styles';
import { buildPalette, type ModePalette } from '../../core/palette.ts';

/** The rounding of everything that floats: popovers, menus, dialogs, bottom sheets (px). */
export const POPUP_RADIUS = 18;

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
  tint = 0,
): Theme {
  const p = buildPalette(mode, overrides, tint);
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
    // Small: buttons, fields and rows 6px; anything that floats (POPUP_RADIUS) 18px.
    shape: { borderRadius: 6 },
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
      // Popovers, menus and dialogs share one rounding, the same as the phone sheets.
      MuiPopover: { styleOverrides: { paper: { borderRadius: POPUP_RADIUS } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: POPUP_RADIUS } } },
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
          root: {
            backgroundColor: p.surfaceVariant,
            borderTop: `1px solid ${p.outline}`,
            height: 52,
          },
        },
      },
      // Compact phone tabs: a small label that stays one line and does not grow when selected.
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: {
            minWidth: 0,
            padding: '0 4px',
            gap: 2,
            '& .MuiSvgIcon-root': { fontSize: 22 },
          },
          label: {
            fontSize: '0.6875rem',
            lineHeight: 1.2,
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            '&.Mui-selected': { fontSize: '0.6875rem', fontWeight: 600 },
          },
        },
      },
    },
  });
}
