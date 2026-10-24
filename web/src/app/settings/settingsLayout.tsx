import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/** A titled group of settings. */
export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box component="section" aria-label={title} sx={{ maxWidth: 640 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
      {hint && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {hint}
        </Typography>
      )}
      {children}
    </Box>
  );
}

/** A setting as a row: its name (and a hint) on the left, the control on the right. */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1, py: 1 }}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography>{label}</Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Box>
      {children}
    </Box>
  );
}
