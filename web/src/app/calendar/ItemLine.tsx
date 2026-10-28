import { ButtonBase } from '@mui/material';
import { styled, useTheme } from '@mui/material/styles';
import type { CSSProperties, PointerEvent } from 'react';
import type { CalendarItem } from '../../core/calendar.ts';
import { continuesFrom } from '../../core/calendarLayout.ts';
import { timePart } from '../../core/dates.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { DueIcon } from '../icons/icons.tsx';

const PRIORITY_KEY = { 1: 'low', 2: 'medium', 3: 'high' } as const;

// One set of styles for every line, made once; what differs per item rides on data attributes
// and a CSS variable (R-FB-94: a style object per line was most of the calendar's render time).
const Line = styled(ButtonBase)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: theme.spacing(0.5),
  width: '100%',
  minWidth: 0,
  height: 18,
  padding: theme.spacing(0, 0.5),
  borderRadius: Number(theme.shape.borderRadius) * 0.75,
  fontSize: 12,
  lineHeight: 1,
  textAlign: 'left',
  color: theme.palette.text.primary,
  borderLeft: '3px solid var(--item-color)',
  backgroundColor: 'transparent',
  cursor: 'pointer',
  touchAction: 'pan-y',
  '&[data-dense]': { height: 16, fontSize: 11 },
  '&[data-due]': { color: theme.palette.text.secondary, borderLeft: 0 },
  '&[data-done]': { textDecoration: 'line-through', opacity: 0.55 },
  '&[data-all-day]:not([data-due])': {
    backgroundColor: 'color-mix(in srgb, var(--item-color) 33%, transparent)',
  },
  '&[data-movable]': { cursor: 'grab' },
  '&:hover': { backgroundColor: theme.palette.action.hover },
  '& .item-due': { fontSize: 12, flexShrink: 0 },
  '& .item-priority': {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '50%',
    border: '2px solid var(--priority-color)',
  },
  '& .item-time': { flexShrink: 0, color: theme.palette.text.secondary },
  '& .item-title': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
}));

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
  const flag = (on: boolean) => (on ? '' : undefined);
  const priority = item.priority > 0 && !due ? PRIORITY_KEY[item.priority as 1 | 2 | 3] : null;
  return (
    <Line
      data-cal-item={item.id}
      data-dense={flag(dense)}
      data-due={flag(due)}
      data-done={flag(item.done)}
      data-all-day={flag(item.allDay)}
      data-movable={flag(item.movable)}
      style={
        {
          '--item-color': item.color,
          ...(priority ? { '--priority-color': theme.punchlist.priority[priority].fill } : {}),
        } as CSSProperties
      }
      title={label}
      aria-label={time ? `${formatTime(time)} ${label}` : label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onPointerDown={onPointerDown}
    >
      {due && <DueIcon className="item-due" />}
      {priority && <span className="item-priority" aria-hidden />}
      {time && <span className="item-time">{formatTime(time)}</span>}
      <span className="item-title">{item.title || t('task.untitled')}</span>
    </Line>
  );
}
