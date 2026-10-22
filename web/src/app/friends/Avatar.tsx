import { Box } from '@mui/material';

/** A person as a round initial on their color. */
export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: color,
        color: 'rgba(0, 0, 0, 0.7)',
        display: 'grid',
        placeItems: 'center',
        fontSize: size * 0.44,
        fontWeight: 600,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </Box>
  );
}
