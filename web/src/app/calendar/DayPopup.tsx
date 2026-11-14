import { Box, Button, Typography } from '@mui/material';
import type { CalendarItem } from '../../core/calendar.ts';
import { localTimeZone } from '../../core/dates.ts';
import { findInbox } from '../../core/lists.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { PropertySheet } from '../tasks/PropertyRow.tsx';
import { ItemLine } from './ItemLine.tsx';

const longDay = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * A day up close (spec: PL-093), from a click on a day or "+N more": what is on it, and a field
 * to add to it. With `time`, a tapped time in the Days view: just the field, for a task then.
 */
export function DayPopup({
  day,
  time = null,
  items,
  anchor,
  onClose,
  onOpenTask,
  onShowDays,
}: {
  day: string;
  /** `HH:mm`: adding at a time rather than to the day */
  time?: string | null;
  items: CalendarItem[];
  anchor: HTMLElement | null;
  onClose: () => void;
  /** `occurrence`: a repeating task's date to come that was picked, not its own date. */
  onOpenTask: (taskId: string, occurrence?: string) => void;
  /** Open this day in the Days view */
  onShowDays?: () => void;
}) {
  const inbox = findInbox(useWorkspace());
  const title = `${longDay.format(new Date(`${day}T12:00:00Z`))}${time ? `, ${formatTime(time)}` : ''}`;
  return (
    <PropertySheet label={title} anchor={anchor} onClose={onClose}>
      <Box sx={{ p: 2, width: { xs: '100%', sm: 340 }, display: 'grid', gap: 1 }}>
        <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
        {!time && (
          <Box sx={{ display: 'grid', gap: 0.25, maxHeight: 280, overflowY: 'auto' }}>
            {items.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('calendar.nothingOn')}
              </Typography>
            )}
            {items.map((item) => (
              <ItemLine
                key={item.id}
                item={item}
                day={day}
                onOpen={() => {
                  onClose();
                  onOpenTask(item.taskId, item.occurrence);
                }}
              />
            ))}
          </Box>
        )}
        {inbox && (
          <AddTaskInput
            key={`${day}${time ?? ''}`}
            autoFocus
            label={time ? t('calendar.addAt', { time: formatTime(time) }) : t('calendar.addToDay')}
            defaults={{
              listId: inbox.id,
              schedule: {
                start: time ? `${day}T${time}` : day,
                end: null,
                allDay: time === null,
                timeZone: localTimeZone(),
              },
            }}
          />
        )}
        {onShowDays && !time && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button size="small" onClick={onShowDays}>
              {t('calendar.showDay')}
            </Button>
          </Box>
        )}
      </Box>
    </PropertySheet>
  );
}
