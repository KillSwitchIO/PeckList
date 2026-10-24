import { Box, ButtonBase, Popover, Typography, useMediaQuery, useTheme } from '@mui/material';
import type { ReactNode } from 'react';
import { useReadOnly } from './readOnly.ts';
import { POPUP_RADIUS } from '../theme/theme.ts';
import { BottomSheet } from '../layout/BottomSheet.tsx';

/** A task property row in the details panel: "icon  Label ........ value". */
export function PropertyRow({
  label,
  icon,
  ariaValue,
  iconColor = 'text.secondary',
  compact = false,
  inline = false,
  onClick,
  children,
}: {
  label: string;
  icon: ReactNode;
  /** Text read out after the label, e.g. "Date: Tomorrow" */
  ariaValue: string;
  iconColor?: string;
  /** Half-width: the label takes only the room it needs and the value truncates. */
  compact?: boolean;
  /** Icon and value only, sized to its content (the label stays in the accessible name). */
  inline?: boolean;
  onClick: (anchor: HTMLElement) => void;
  children: ReactNode;
}) {
  // Shown, not changed, on a task I can only view.
  const readOnly = useReadOnly();
  return (
    <ButtonBase
      disabled={readOnly}
      onClick={(event) => onClick(event.currentTarget)}
      aria-haspopup="dialog"
      aria-label={`${label}: ${ariaValue}`}
      sx={{
        width: inline ? 'auto' : '100%',
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: inline ? 1 : 1.5,
        px: 1,
        py: 1,
        borderRadius: 2,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ display: 'flex', color: iconColor }}>{icon}</Box>
      {!inline && (
        <Typography
          color="text.secondary"
          sx={{ width: compact ? 'auto' : 84, flexShrink: 0, textAlign: 'left' }}
        >
          {label}
        </Typography>
      )}
      <Box
        sx={{
          flexGrow: 1,
          minWidth: 0,
          textAlign: 'left',
          ...((compact || inline) && {
            '& > *': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }),
        }}
      >
        {children}
      </Box>
    </ButtonBase>
  );
}

/** Where a property's editor opens: a popover next to the row, or a bottom sheet on phones. */
export function PropertySheet({
  label,
  anchor,
  onClose,
  children,
}: {
  label: string;
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  if (isPhone) {
    return (
      <BottomSheet
        open={anchor !== null}
        onClose={onClose}
        label={label}
        paperSx={{ alignItems: 'center' }}
      >
        {children}
      </BottomSheet>
    );
  }
  return (
    <Popover
      open={anchor !== null}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{
        paper: { role: 'dialog', 'aria-label': label, sx: { borderRadius: `${POPUP_RADIUS}px` } },
      }}
    >
      {children}
    </Popover>
  );
}
