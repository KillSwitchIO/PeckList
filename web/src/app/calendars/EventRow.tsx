import { Box, ButtonBase, IconButton, Typography } from '@mui/material';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlacedEvent } from '../../core/calendarEvents.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { CheckIcon } from '../icons/icons.tsx';
import { useCompactRows } from '../layout/rowLayout.ts';
import { formatDay } from '../format.ts';
import { rowTime } from './calendarText.ts';
import { EventPopover } from './EventPopover.tsx';
import { useEventInk } from './eventInk.ts';
import { useCalendarOffline, useEventsStore, useHideEvent } from './useCalendarEvents.ts';

/** How long the ticked square shows before the row goes (the same beat as a task's tick). */
const TICK_MS = 250;

/**
 * A shown event in a list (Today, Upcoming), drawn as an event and not a task (spec: PL-134
 * decision 2): a rounded square in the calendar's colour where a task has its circle, the time on
 * the right, no list, tag or priority. Ticking the square hides it with Undo; the rest opens it.
 */
export function EventRow({
  placed,
  day,
  showDay = false,
}: {
  placed: PlacedEvent;
  /** The day it is listed under (an event begun the day before says when it ends) */
  day: string;
  /** Name the day too (a list of several days with no day headings) */
  showDay?: boolean;
}) {
  const { event } = placed;
  const today = useToday();
  const compact = useCompactRows();
  const offline = useCalendarOffline();
  const hide = useHideEvent();
  const store = useEventsStore();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [ticked, setTicked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The hide the tick's beat is waiting to make. */
  const fire = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      // Gone before the beat ended (another view, say): the tick still counts.
      if (timer.current) clearTimeout(timer.current);
      fire.current?.();
    },
    [],
  );
  const title = event.title || t('calendars.event.untitled');
  const time = rowTime(placed, day);
  const when = showDay ? `${formatDay(placed.first, today)}, ${time}` : time;
  const color = useEventInk()(event.color);
  return (
    <Box
      data-event-row={placed.key}
      style={{ '--event-color': color } as CSSProperties}
      sx={{
        display: 'flex',
        alignItems: 'center',
        minHeight: compact ? 32 : 40,
        pl: '4px',
        borderBottom: 1,
        borderColor: 'divider',
        opacity: ticked ? 0.5 : 1,
        transition: `opacity ${TICK_MS}ms`,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <IconButton
        size="small"
        role="checkbox"
        aria-checked={ticked}
        aria-label={t('calendars.event.tick', { title })}
        disabled={offline || !hide || ticked}
        onClick={(click) => {
          click.stopPropagation();
          setTicked(true);
          // Queued at once, so a page closed during the beat still sends it.
          store?.queueHide(event);
          fire.current = () => {
            fire.current = null;
            timer.current = null;
            hide?.(event);
          };
          timer.current = setTimeout(() => fire.current?.(), TICK_MS);
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 18,
            height: 18,
            m: '2px',
            borderRadius: '5px',
            border: '2px solid var(--event-color)',
            bgcolor: ticked ? 'var(--event-color)' : 'transparent',
            color: 'common.white',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {ticked && <CheckIcon sx={{ fontSize: 14 }} />}
        </Box>
      </IconButton>
      <ButtonBase
        aria-haspopup="dialog"
        aria-label={t('calendars.event.open', { title, when })}
        onClick={(click) => setAnchor(click.currentTarget)}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          py: compact ? 0.25 : 1,
          pr: 1.5,
          textAlign: 'left',
        }}
      >
        {/* Text from outside the app: a text node, never markup (Security, PL-134 N3). */}
        <Typography
          noWrap
          sx={{ flexGrow: 1, minWidth: 0, ...(compact ? { fontSize: '0.875rem' } : {}) }}
        >
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
          {when}
        </Typography>
      </ButtonBase>
      <EventPopover
        placed={anchor ? placed : null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
      />
    </Box>
  );
}
