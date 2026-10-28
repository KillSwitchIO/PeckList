import { Box, useTheme, type SxProps, type Theme } from '@mui/material';
import { createElement } from 'react';
import { ensureContrast, WCAG_UI } from '../../core/palette.ts';
import type { List } from '../../core/types.ts';
import { SYMBOL_PREFIX, useListSymbol } from './listSymbols.ts';

/**
 * How a list is marked beside its name: its line icon in its color, or its emoji, when it has one;
 * else its color as a dot. `faded` for lists shown dimmed (archived).
 */
export function ListMark({
  list,
  faded = false,
  sx,
}: {
  list: Pick<List, 'color' | 'icon'>;
  faded?: boolean;
  sx?: SxProps<Theme>;
}) {
  const theme = useTheme();
  const Symbol = useListSymbol(list.icon);
  if (Symbol) {
    // createElement: the icon is looked up by name, not a component made during render.
    return createElement(Symbol, {
      'aria-hidden': true,
      sx: [
        {
          fontSize: 18,
          // Pastel list colors are faint on a light page: deepened until they read as an icon.
          color: ensureContrast(list.color, theme.palette.background.paper, WCAG_UI),
          opacity: faded ? 0.6 : 1,
          flexShrink: 0,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ],
    });
  }
  // An emoji (a line icon still loading shows the dot below).
  if (list.icon && !list.icon.startsWith(SYMBOL_PREFIX)) {
    return (
      <Box
        component="span"
        aria-hidden
        sx={[
          {
            display: 'inline-flex',
            justifyContent: 'center',
            width: 18,
            fontSize: '0.95rem',
            lineHeight: 1,
            opacity: faded ? 0.6 : 1,
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {list.icon}
      </Box>
    );
  }
  return (
    <Box
      sx={[
        {
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: list.color,
          opacity: faded ? 0.6 : 1,
          flexShrink: 0,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
