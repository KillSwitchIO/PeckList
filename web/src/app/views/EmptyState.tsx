import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { EmptyMark } from './EmptyMark.tsx';

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        py: 10,
        gap: 1,
        color: 'text.secondary',
      }}
    >
      {/* Our logo, flipping round to a check (a view's own icon, when it gives one). */}
      {icon ? (
        <Box sx={{ color: 'primary.main', '& svg': { fontSize: 56 } }}>{icon}</Box>
      ) : (
        <Box sx={{ mb: 1 }}>
          <EmptyMark />
        </Box>
      )}
      <Typography variant="h2" component="p" color="text.primary">
        {title}
      </Typography>
      {hint && <Typography>{hint}</Typography>}
    </Box>
  );
}
