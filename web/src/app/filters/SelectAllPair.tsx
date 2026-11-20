// Select all and Deselect all for a section of picks (the filter menu's lists and tags, the
// saved filter's lists and tags). Two small text buttons beside the section's title; both are
// always there, the one with nothing to do greyed out, so picking never moves the layout. Greyed
// out is aria-disabled, not disabled: a button that went disabled under the keyboard would drop
// its focus.
// Deselect all empties the section, which the filters read as that kind left open: everything
// shows, as before anything was picked.

import { Box, Button } from '@mui/material';
import { t } from '../i18n/i18n.ts';

const small = {
  minWidth: 0,
  px: 0.75,
  py: 0,
  fontSize: '0.75rem',
  lineHeight: 1.75,
  fontWeight: 500,
} as const;

function SmallButton({
  label,
  section,
  idle,
  onClick,
}: {
  label: string;
  section: string;
  idle: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="small"
      aria-label={`${label}: ${section}`}
      aria-disabled={idle || undefined}
      disableRipple={idle}
      onClick={idle ? undefined : onClick}
      sx={{
        ...small,
        ...(idle
          ? { color: 'text.disabled', cursor: 'default', bgcolor: 'transparent !important' }
          : {}),
      }}
    >
      {label}
    </Button>
  );
}

export function SelectAllPair({
  section,
  total,
  picked,
  onAll,
  onNone,
}: {
  /** The section's title, for the buttons' accessible names ("Select all: Lists"). */
  section: string;
  /** How many there are to pick, and how many of them are picked now. */
  total: number;
  picked: number;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 0.25, ml: 'auto', flexShrink: 0 }}>
      <SmallButton
        label={t('filter.selectAll')}
        section={section}
        idle={picked >= total}
        onClick={onAll}
      />
      <SmallButton
        label={t('filter.deselectAll')}
        section={section}
        idle={picked === 0}
        onClick={onNone}
      />
    </Box>
  );
}
