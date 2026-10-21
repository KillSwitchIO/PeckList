import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

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
      <Box sx={{ color: 'primary.main', '& svg': { fontSize: 56 } }}>
        {icon ?? <TaskAltRounded />}
      </Box>
      <Typography variant="h2" component="p" color="text.primary">
        {title}
      </Typography>
      {hint && <Typography>{hint}</Typography>}
    </Box>
  );
}
