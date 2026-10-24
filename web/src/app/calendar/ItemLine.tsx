import { Box, ButtonBase, useTheme } from '@mui/material';
import type { PointerEvent } from 'react';
import type { CalendarItem } from '../../core/calendar.ts';
import { continuesFrom } from '../../core/calendarLayout.ts';
import { timePart } from '../../core/dates.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { DueIcon } from '../icons/icons.tsx';

const PRIORITY_KEY = { 1: 'low', 2: 'medium', 3: 'high' } as const;

/** The line a calendar item takes in a month day or the all-day row: color mark, time, title. */
export function ItemLine({
  item,
  day,
  onOpen,
  onPointerDown,
  dense = false,
}: {
  item: CalendarItem;
  /** The day it is shown on (a span shows its title on each day it covers) */
  day: string;
  onOpen: () => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  dense?: boolean;
}) {
  const theme = useTheme();
  const due = item.kind === 'due';
  const time = !item.allDay && !continuesFrom(item, day) ? timePart(item.start) : null;
  const label = due ? t('calendar.dueFlag', { title: item.title }) : item.title;
  return (
    <ButtonBase
      data-cal-item={item.id}
      title={label}
      aria-label={time ? `${formatTime(time)} ${label}` : label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onPointerDown={onPointerDown}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 0.5,
        width: '100%',
        minWidth: 0,
        height: dense ? 16 : 18,
        px: 0.5,
        borderRadius: 0.75,
        fontSize: dense ? 11 : 12,
        lineHeight: 1,
        textAlign: 'left',
        color: due ? 'text.secondary' : 'text.primary',
        textDecoration: item.done ? 'line-through' : 'none',
        opacity: item.done ? 0.55 : 1,
        borderLeft: due ? 0 : 3,
        borderColor: item.color,
        bgcolor: item.allDay && !due ? `${item.color}55` : 'transparent',
        cursor: item.movable ? 'grab' : 'pointer',
        touchAction: 'pan-y',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {due && <DueIcon sx={{ fontSize: 12, flexShrink: 0 }} />}
      {item.priority > 0 && !due && (
        <Box
          component="span"
          aria-hidden
          sx={{
            width: 6,
            height: 6,
            flexShrink: 0,
            borderRadius: '50%',
            border: 2,
            borderColor: theme.punchlist.priority[PRIORITY_KEY[item.priority as 1 | 2 | 3]].fill,
          }}
        />
      )}
      {time && (
        <Box component="span" sx={{ flexShrink: 0, color: 'text.secondary' }}>
          {formatTime(time)}
        </Box>
      )}
      <Box
        component="span"
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
      >
        {item.title || t('task.untitled')}
      </Box>
    </ButtonBase>
  );
}
