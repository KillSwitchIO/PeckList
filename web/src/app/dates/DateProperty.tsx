import {
  Box,
  ButtonBase,
  Drawer,
  Popover,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { formatWhen } from '../format.ts';
import { DatePickerPanel } from './DatePickerPanel.tsx';
import { fromDateValue, type DateValue } from './dateValue.ts';

/**
 * A task property row ("icon  Label ........ value") that opens the date picker:
 * a popover next to the row, or a bottom sheet on phones.
 */
export function DateProperty({
  label,
  icon,
  value,
  today,
  placeholder,
  valueColor,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: DateValue | null;
  today: string;
  placeholder: string;
  valueColor?: string;
  onChange: (value: DateValue | null) => void;
}) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const apply = (next: DateValue | null) => {
    onChange(next);
    close();
  };
  const display = value ? formatWhen(fromDateValue(value), today) : placeholder;
  const panel = anchor && (
    <DatePickerPanel value={value} today={today} onApply={apply} onCancel={close} />
  );

  return (
    <>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="dialog"
        aria-label={`${label}: ${display}`}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1,
          py: 1,
          borderRadius: 2,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            color: value ? (valueColor ?? 'text.secondary') : 'text.secondary',
          }}
        >
          {icon}
        </Box>
        <Typography color="text.secondary" sx={{ width: 64, textAlign: 'left' }}>
          {label}
        </Typography>
        <Typography
          sx={{
            flexGrow: 1,
            textAlign: 'left',
            color: value ? (valueColor ?? 'text.primary') : 'text.disabled',
          }}
        >
          {display}
        </Typography>
      </ButtonBase>

      {isPhone ? (
        <Drawer
          anchor="bottom"
          open={anchor !== null}
          onClose={close}
          slotProps={{
            paper: {
              role: 'dialog',
              'aria-label': label,
              sx: {
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                alignItems: 'center',
                pb: 'env(safe-area-inset-bottom)',
              },
            },
          }}
        >
          {panel}
        </Drawer>
      ) : (
        <Popover
          open={anchor !== null}
          anchorEl={anchor}
          onClose={close}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{ paper: { role: 'dialog', 'aria-label': label, sx: { borderRadius: 3 } } }}
        >
          {panel}
        </Popover>
      )}
    </>
  );
}
