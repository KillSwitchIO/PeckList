import { Box, type SxProps, type Theme } from '@mui/material';
import type { List } from '../../core/types.ts';

/**
 * How a list is marked beside its name: its icon (an emoji) when it has one, else its color as a
 * dot. `faded` for lists shown dimmed (archived).
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
  if (list.icon) {
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
