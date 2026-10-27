import { Popover } from '@mui/material';
import { MonthCalendar } from './MonthCalendar.tsx';

/** The month calendar under a view's title, to jump to a day. */
export function MonthPickerPopover({
  anchor,
  onClose,
  selected,
  today,
  weekStartsOn,
  onSelect,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  selected: string | null;
  today: string;
  weekStartsOn: number;
  onSelect: (date: string) => void;
}) {
  return (
    <Popover
      open={anchor !== null}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { p: 1, width: 300 } } }}
    >
      <MonthCalendar
        selected={selected}
        today={today}
        weekStartsOn={weekStartsOn}
        onSelect={onSelect}
      />
    </Popover>
  );
}
