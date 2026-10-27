import { Box, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/** A page that is one card in the middle: signing in, making an account, connecting to a server. */
export function CenteredCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Box
      component="main"
      sx={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        px: 2,
        pt: 'env(safe-area-inset-top)',
        pb: 'env(safe-area-inset-bottom)',
        bgcolor: 'background.default',
      }}
    >
      <Paper
        variant="outlined"
        sx={{ width: '100%', maxWidth: 380, p: { xs: 3, sm: 4 }, borderRadius: 3 }}
      >
        <Typography variant="h1" sx={{ fontSize: '1.375rem', mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {subtitle}
        </Typography>
        {children}
      </Paper>
    </Box>
  );
}
