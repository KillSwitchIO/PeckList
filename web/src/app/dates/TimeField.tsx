import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import { Box, Button, Typography } from '@mui/material';
import { useState } from 'react';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { PropertySheet } from '../tasks/PropertyRow.tsx';
import { DEFAULT_TIME } from './dateValue.ts';
import { TimeWheels } from './TimeWheels.tsx';

/**
 * A time of day in Settings (R-FB-97): shown on the person's clock (12 or 24 hour), set with the
 * same wheels as the date and reminder pickers, in the same sheet (a popover, or a bottom sheet
 * on a phone). Nothing changes until Done.
 */
export function TimeField({
  label,
  value,
  emptyText,
  onChange,
}: {
  label: string;
  /** `HH:mm`, or null for none (only with `emptyText`) */
  value: string | null;
  /** What no time reads as; given, the sheet also offers to remove the time */
  emptyText?: string;
  onChange: (time: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(value ?? DEFAULT_TIME);
  const shown = value ? formatTime(value) : (emptyText ?? '');
  const close = () => setAnchor(null);
  return (
    <>
      <Button
        variant="outlined"
        color="inherit"
        startIcon={<AccessTimeRounded fontSize="small" />}
        aria-label={`${label}: ${shown}`}
        onClick={(event) => {
          setDraft(value ?? DEFAULT_TIME);
          setAnchor(event.currentTarget);
        }}
        sx={{ textTransform: 'none', justifyContent: 'flex-start', minWidth: 140 }}
      >
        {shown}
      </Button>
      <PropertySheet label={label} anchor={anchor} onClose={close}>
        {anchor && (
          <Box sx={{ width: { sm: 300 }, py: 1, display: 'grid', gap: 1 }}>
            <Typography variant="h6" component="h2" sx={{ px: 2.5, pt: 1, fontSize: 18 }}>
              {label}
            </Typography>
            <TimeWheels value={draft} onChange={setDraft} />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 1.5, pb: 0.5 }}>
              {emptyText !== undefined && value !== null && (
                <Button
                  sx={{ mr: 'auto' }}
                  onClick={() => {
                    onChange(null);
                    close();
                  }}
                >
                  {t('date.removeTime')}
                </Button>
              )}
              <Button onClick={close}>{t('common.cancel')}</Button>
              <Button
                variant="contained"
                disableElevation
                onClick={() => {
                  onChange(draft);
                  close();
                }}
              >
                {t('common.done')}
              </Button>
            </Box>
          </Box>
        )}
      </PropertySheet>
    </>
  );
}
