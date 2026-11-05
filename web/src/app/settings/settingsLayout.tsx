import { Box, ButtonBase, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { ChevronRightIcon } from '../icons/icons.tsx';

/** A titled group of settings. `plain` keeps the title for screen readers only. */
export function Section({
  title,
  hint,
  action,
  plain = false,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <Box component="section" aria-label={title} sx={{ maxWidth: 640 }}>
      {!plain && (
        <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 30, mb: 0.5 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          {action}
        </Box>
      )}
      {hint && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {hint}
        </Typography>
      )}
      {children}
    </Box>
  );
}

/**
 * A setting as a row: its name (and a hint) on the left, the control on the right. When both do
 * not fit (phones), the control moves under the name instead of squeezing its value. Menus share
 * one width, so a column of them lines up.
 */
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
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 2,
        rowGap: 1,
        py: 1,
      }}
    >
      <Box sx={{ flex: '1 1 10rem', minWidth: 0 }}>
        <Typography>{label}</Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary" component="div">
            {hint}
          </Typography>
        )}
      </Box>
      {children && (
        <Box sx={{ flexShrink: 0, maxWidth: '100%', '& .MuiTextField-root': { minWidth: 160 } }}>
          {children}
        </Box>
      )}
    </Box>
  );
}

/** A row that opens a page of its own. Its hover color reaches a little past the text. */
export function LinkRow({ to, label, hint }: { to: string; label: string; hint?: string }) {
  return (
    <ButtonBase
      component={RouterLink}
      to={to}
      sx={{
        display: 'flex',
        width: 'calc(100% + 16px)',
        mx: -1,
        px: 1,
        justifyContent: 'flex-start',
        textAlign: 'left',
        borderRadius: 2,
        '& > *': { flexGrow: 1 },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <SettingRow label={label} {...(hint ? { hint } : {})}>
        <ChevronRightIcon sx={{ color: 'text.secondary', display: 'block' }} />
      </SettingRow>
    </ButtonBase>
  );
}
