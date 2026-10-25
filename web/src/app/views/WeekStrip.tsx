import { Box, ButtonBase, Typography } from '@mui/material';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addDays, daysBetween } from '../../core/dates.ts';
import { t } from '../i18n/i18n.ts';
import { dayTitle } from './dayLabels.ts';

/** Weeks the strip reaches either side of this one. */
const WEEKS_BACK = 104;
const WEEKS_AHEAD = 156;
const PAGES = WEEKS_BACK + WEEKS_AHEAD + 1;
/** Quiet this long after the last scroll event: the swipe has settled on a week. */
const SETTLE_MS = 140;
/** A mouse drag this far is a swipe (not a click on a day). */
const DRAG_PX = 6;

const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });

/**
 * Upcoming's week strip (spec: R-FB-47): one week a page, swiped sideways with a finger, a
 * trackpad or a mouse drag. It shows `week`; when someone swipes it to another week, `onSwipe`
 * says which. `focus` is the day at the top of the list, ringed.
 */
export function WeekStrip({
  week,
  thisWeek,
  today,
  focus,
  busyIn,
  onSwipe,
  onPick,
}: {
  week: string;
  thisWeek: string;
  today: string;
  focus: string;
  /** The days of the week from `start` with something planned */
  busyIn: (start: string) => Set<string>;
  onSwipe: (week: string) => void;
  onPick: (date: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const indexOf = (start: string) =>
    Math.min(PAGES - 1, Math.max(0, WEEKS_BACK + Math.round(daysBetween(thisWeek, start) / 7)));
  const weekAt = (index: number) => addDays(thisWeek, (index - WEEKS_BACK) * 7);
  const wanted = indexOf(week);
  // The page in view while swiping, so the pages beside it are drawn.
  const [visible, setVisible] = useState(wanted);
  // Scrolls the strip makes itself (to follow the list) are not swipes.
  const ownScroll = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragged = useRef(false);
  const latest = useRef({ onSwipe, weekAt });
  useEffect(() => {
    latest.current = { onSwipe, weekAt };
  });
  useEffect(() => () => clearTimeout(settle.current ?? undefined), []);

  // Show `week`: at once the first time, then sliding there.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !element.clientWidth) return;
    const left = wanted * element.clientWidth;
    if (Math.abs(element.scrollLeft - left) < 2) return;
    ownScroll.current = true;
    element.scrollTo({ left, behavior: placed.current ? 'smooth' : 'auto' });
    placed.current = true;
  }, [wanted]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element || !element.clientWidth) return;
    setVisible(Math.round(element.scrollLeft / element.clientWidth));
    clearTimeout(settle.current ?? undefined);
    settle.current = setTimeout(() => {
      const index = Math.round(element.scrollLeft / element.clientWidth);
      if (ownScroll.current) {
        ownScroll.current = false;
        return;
      }
      latest.current.onSwipe(latest.current.weekAt(index));
    }, SETTLE_MS);
  };

  // A mouse drags the strip like a finger.
  const press = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = scroller.current;
    if (event.pointerType !== 'mouse' || event.button !== 0 || !element) return;
    const x0 = event.clientX;
    const left0 = element.scrollLeft;
    const page0 = Math.round(left0 / (element.clientWidth || 1));
    dragged.current = false;
    const move = (next: PointerEvent) => {
      const dx = next.clientX - x0;
      if (!dragged.current && Math.abs(dx) < DRAG_PX) return;
      if (!dragged.current) {
        dragged.current = true;
        element.style.scrollSnapType = 'none';
      }
      element.scrollLeft = left0 - dx;
    };
    const up = (next: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragged.current) return;
      const dx = next.clientX - x0;
      const page = page0 + (dx < -40 ? 1 : dx > 40 ? -1 : 0);
      element.style.scrollSnapType = '';
      ownScroll.current = false;
      element.scrollTo({ left: page * element.clientWidth, behavior: 'smooth' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const drawn = new Set<number>();
  for (const middle of [wanted, visible]) {
    for (let index = middle - 1; index <= middle + 1; index += 1) {
      if (index >= 0 && index < PAGES) drawn.add(index);
    }
  }

  return (
    <Box
      ref={scroller}
      onScroll={onScroll}
      onPointerDown={press}
      onClickCapture={(event) => {
        if (!dragged.current) return;
        dragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      sx={{
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollSnapType: 'x mandatory',
        overscrollBehaviorX: 'contain',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        touchAction: 'pan-x pan-y',
      }}
    >
      <Box sx={{ position: 'relative', width: `${PAGES * 100}%`, height: 58 }}>
        {[...drawn].map((index) => {
          const start = weekAt(index);
          const current = index === wanted;
          const busy = busyIn(start);
          return (
            <Box
              key={start}
              {...(current
                ? { role: 'group', 'aria-label': t('agenda.week') }
                : { 'aria-hidden': true, inert: true })}
              sx={{
                position: 'absolute',
                top: 0,
                left: `${(index * 100) / PAGES}%`,
                width: `${100 / PAGES}%`,
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 0.5,
                scrollSnapAlign: 'start',
              }}
            >
              {Array.from({ length: 7 }, (_, day) => {
                const date = addDays(start, day);
                const past = date < today;
                const isToday = date === today;
                const focused = date === focus;
                return (
                  <ButtonBase
                    key={date}
                    aria-label={dayTitle(date, today)}
                    aria-current={isToday ? 'date' : undefined}
                    aria-pressed={focused}
                    onClick={() => onPick(date)}
                    sx={{
                      flexDirection: 'column',
                      py: 0.5,
                      borderRadius: 1.5,
                      border: 1.5,
                      borderColor: focused ? 'primary.main' : 'transparent',
                      color: past ? 'text.disabled' : 'text.primary',
                      bgcolor: isToday ? 'action.selected' : undefined,
                      userSelect: 'none',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Typography variant="caption" color="inherit" sx={{ fontSize: 11 }}>
                      {weekdayShort.format(new Date(`${date}T12:00:00Z`))}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="inherit"
                      sx={{ fontWeight: isToday ? 700 : 500 }}
                    >
                      {Number(date.slice(8))}
                    </Typography>
                    <Box
                      component="span"
                      sx={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        bgcolor: busy.has(date) ? 'primary.main' : 'transparent',
                      }}
                    />
                  </ButtonBase>
                );
              })}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
