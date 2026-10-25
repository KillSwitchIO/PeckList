import { Box } from '@mui/material';
import { atMinutes } from '../../core/calendarLayout.ts';
import { formatTime } from '../format.ts';

/** `HH:mm` for minutes into a day (1440 is midnight at its end). */
const clock = (minutes: number) => atMinutes('2000-01-01', minutes).slice(11);

/**
 * While a task is dragged or stretched in the Days view, its start (and end, when it has one)
 * just above its top left corner (spec: PL-093), so it is plain where letting go puts it.
 */
export function TimeLabel({
  top,
  bottom,
  hourHeight,
  left,
}: {
  top: number;
  bottom: number | null;
  hourHeight: number;
  /** CSS left of the task it labels */
  left: string;
}) {
  const y = (top / 60) * hourHeight;
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute',
        // Above the task, or just inside it at the very top of the day.
        top: y >= 22 ? y - 22 : y + 2,
        left,
        zIndex: 4,
        px: 0.75,
        height: 20,
        display: 'flex',
        alignItems: 'center',
        borderRadius: 1,
        bgcolor: 'text.primary',
        color: 'background.paper',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        boxShadow: 2,
      }}
    >
      {formatTime(clock(top))}
      {bottom !== null && bottom > top ? ` - ${formatTime(clock(bottom))}` : ''}
    </Box>
  );
}
