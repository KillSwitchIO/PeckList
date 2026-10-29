import ZoomInRounded from '@mui/icons-material/ZoomInRounded';
import ZoomOutRounded from '@mui/icons-material/ZoomOutRounded';
import {
  Box,
  Button,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useLayoutEffect, useRef, useState } from 'react';
import { addDays, daysBetween } from '../../core/dates.ts';
import { barOf, draggedSchedule, fitRows, ownRows, type Bar } from '../../core/timeline.ts';
import { updateTask } from '../../core/tasks.ts';
import type { Id, Task } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { GroupSection } from '../views/GroupSection.tsx';
import { monthTitle } from '../layout/miniCalendarText.ts';
import { DAY_WIDTHS, useTimelinePrefs } from './listLayout.ts';

const ROW = 34;
const HEADER = 44;
/** The grip at each end of a bar, for stretching it. */
const GRIP = 10;
/** A press that moves this far is a drag, not a tap. */
const MOVE_PX = 5;
/** A finger holds a bar this long to pick it up; moving sooner scrolls (as the calendar). */
const HOLD_MS = 350;

const weekdayNarrow = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
const at = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * A list as a timeline (spec: PL-055, R-FB-56): each dated task a bar across its days, to drag to
 * other days or stretch by its ends; tasks without a date sit under it. Rows are one per task, or
 * fitted together so tasks that do not overlap share a row.
 */
export function TimelineView({ tasks, canEdit }: { tasks: Task[]; canEdit: boolean }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const { open } = useTaskSelection();
  const [prefs, setPrefs] = useTimelinePrefs();
  const day = prefs.dayWidth;
  const scroller = useRef<HTMLDivElement>(null);
  // A bar being dragged: which part, and by how many days so far.
  const [drag, setDrag] = useState<{ id: Id; part: 'move' | 'start' | 'end'; days: number } | null>(
    null,
  );

  const dated = tasks.filter((task) => task.schedule);
  const undated = tasks.filter((task) => !task.schedule);
  const bars = dated.map(barOf).filter((bar): bar is Bar => bar !== null);
  const earliest = bars.reduce((low, bar) => (bar.from < low ? bar.from : low), today);
  const latest = bars.reduce((high, bar) => (bar.to > high ? bar.to : high), today);
  const from = addDays(earliest, -14);
  const to = addDays(latest, 60);
  const count = daysBetween(from, to) + 1;
  const days = Array.from({ length: count }, (_, index) => addDays(from, index));
  const rows = prefs.fit ? fitRows(bars) : ownRows(bars);
  const rowCount = Math.max(1, ...[...rows.values()].map((row) => row + 1));
  const byId = new Map(dated.map((task) => [task.id, task]));
  const colorOf = (task: Task) =>
    workspace.entities.lists.find((list) => list.id === task.listId)?.color ?? '#B8BCC4';

  // Open on today, a little in from the left.
  const toToday = (smooth: boolean) => {
    const element = scroller.current;
    if (!element) return;
    const left = Math.max(0, (daysBetween(from, today) - 2) * day);
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      element.scrollLeft = left;
    }
  };
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (placed.current) return;
    placed.current = true;
    toToday(false);
  });

  const press = (
    event: React.PointerEvent<HTMLElement>,
    bar: Bar,
    part: 'move' | 'start' | 'end',
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const task = byId.get(bar.id);
    if (!task?.schedule) return;
    const schedule = task.schedule;
    const x0 = event.clientX;
    const y0 = event.clientY;
    const id = event.pointerId;
    // A mouse drags once it moves a little. A finger scrolls the timeline, bars and all, unless it
    // first holds a bar still for a moment, as on the calendar (R-FB-155).
    const touch = event.pointerType === 'touch';
    let lifted = !touch;
    let moved = false;
    let scrolled = false;
    let days = 0;
    const timer =
      touch && canEdit
        ? setTimeout(() => {
            lifted = true;
            navigator.vibrate?.(10);
            setDrag({ id: bar.id, part, days: 0 });
          }, HOLD_MS)
        : null;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      const far = Math.hypot(next.clientX - x0, next.clientY - y0) >= MOVE_PX;
      if (!lifted) {
        // Moved before the hold: a scroll, which the page has.
        if (far) {
          scrolled = true;
          finish();
        }
        return;
      }
      if (!moved && !far) return;
      if (!canEdit) return;
      moved = true;
      days = Math.round((next.clientX - x0) / day);
      setDrag({ id: bar.id, part, days });
    };
    // While a finger holds a bar, moving it must not scroll the timeline.
    const hold = (touchEvent: TouchEvent) => {
      if (lifted && touchEvent.cancelable) touchEvent.preventDefault();
    };
    const finish = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', finish);
      document.removeEventListener('touchmove', hold);
      setDrag(null);
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      const wasLifted = lifted && touch;
      finish();
      if (scrolled) return;
      if (!moved) {
        // A tap opens the task; a hold let go without moving changes nothing.
        if (part === 'move' && !wasLifted) open(bar.id);
        return;
      }
      if (days !== 0) {
        apply(
          (ctx, ws) =>
            updateTask(ctx, ws, bar.id, { schedule: draggedSchedule(schedule, part, days) }),
          part === 'move' ? t('undo.moved') : t('undo.datesChanged'),
        );
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', finish);
    document.addEventListener('touchmove', hold, { passive: false });
  };

  /** Where a bar shows, with a drag in progress applied. */
  const shown = (bar: Bar) => {
    if (drag?.id !== bar.id) return bar;
    const task = byId.get(bar.id)!;
    const next = { ...task, schedule: draggedSchedule(task.schedule!, drag.part, drag.days) };
    return barOf(next) ?? bar;
  };

  const zoom = (by: 1 | -1) => {
    const index = DAY_WIDTHS.indexOf(day as (typeof DAY_WIDTHS)[number]);
    const next =
      DAY_WIDTHS[Math.min(DAY_WIDTHS.length - 1, Math.max(0, (index < 0 ? 2 : index) + by))]!;
    setPrefs({ dayWidth: next });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Button size="small" variant="outlined" onClick={() => toToday(true)}>
          {t('calendar.today')}
        </Button>
        <Tooltip title={t('timeline.zoomOut')}>
          <span>
            <IconButton
              size="small"
              aria-label={t('timeline.zoomOut')}
              disabled={day <= DAY_WIDTHS[0]}
              onClick={() => zoom(-1)}
            >
              <ZoomOutRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('timeline.zoomIn')}>
          <span>
            <IconButton
              size="small"
              aria-label={t('timeline.zoomIn')}
              disabled={day >= DAY_WIDTHS[DAY_WIDTHS.length - 1]!}
              onClick={() => zoom(1)}
            >
              <ZoomInRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={prefs.fit ? 'fit' : 'each'}
          aria-label={t('timeline.rows')}
          onChange={(_, next: 'fit' | 'each' | null) => next && setPrefs({ fit: next === 'fit' })}
        >
          <ToggleButton value="each" sx={{ px: 1.25, py: 0.25 }}>
            {t('timeline.rows.each')}
          </ToggleButton>
          <ToggleButton value="fit" sx={{ px: 1.25, py: 0.25 }}>
            {t('timeline.rows.fit')}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box
        ref={scroller}
        role="grid"
        aria-label={t('list.layout.timeline')}
        sx={{
          position: 'relative',
          overflow: 'auto',
          maxHeight: 'calc(100dvh - 260px)',
          minHeight: 160,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          overscrollBehaviorX: 'contain',
        }}
      >
        <Box sx={{ position: 'relative', width: count * day, height: HEADER + rowCount * ROW + 8 }}>
          {/* Days, with weekends shaded and today marked. */}
          {days.map((each, index) => {
            const weekend = [0, 6].includes(at(each).getUTCDay());
            const first = each.endsWith('-01') || index === 0;
            return (
              <Box
                key={each}
                aria-hidden
                sx={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: index * day,
                  width: day,
                  borderLeft: 1,
                  borderColor: first ? 'text.disabled' : 'divider',
                  bgcolor: weekend ? 'action.hover' : undefined,
                }}
              />
            );
          })}
          <Box
            aria-hidden
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              height: HEADER,
              bgcolor: 'background.paper',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            {days.map((each, index) =>
              each.endsWith('-01') || index === 0 ? (
                <Typography
                  key={`m-${each}`}
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    top: 2,
                    left: index * day + 4,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {monthTitle(each, today)}
                </Typography>
              ) : null,
            )}
            {days.map((each, index) => (
              <Box
                key={`d-${each}`}
                sx={{
                  position: 'absolute',
                  top: 20,
                  left: index * day,
                  width: day,
                  textAlign: 'center',
                  fontSize: 11,
                  lineHeight: '20px',
                  color: each === today ? 'primary.contrastText' : 'text.secondary',
                  fontWeight: each === today ? 700 : 400,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    px: 0.5,
                    borderRadius: 1,
                    bgcolor: each === today ? 'primary.main' : undefined,
                  }}
                >
                  {day >= 32 ? `${weekdayNarrow.format(at(each))} ` : ''}
                  {Number(each.slice(8))}
                </Box>
              </Box>
            ))}
          </Box>
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              top: HEADER,
              bottom: 0,
              left: daysBetween(from, today) * day + day / 2,
              width: 2,
              bgcolor: 'primary.main',
              opacity: 0.6,
              zIndex: 1,
            }}
          />
          {bars.map((original) => {
            const bar = shown(original);
            const task = byId.get(bar.id)!;
            const left = daysBetween(from, bar.from) * day;
            const width = (daysBetween(bar.from, bar.to) + 1) * day;
            const color = colorOf(task);
            const title = task.title || t('task.untitled');
            const dragging = drag?.id === bar.id;
            return (
              <Box
                key={bar.id}
                role="button"
                tabIndex={0}
                aria-label={t('timeline.bar', { title })}
                data-timeline-bar={bar.id}
                onPointerDown={(event) => press(event, original, 'move')}
                // A held finger picks the bar up: no menu from the browser.
                onContextMenu={(event) => event.preventDefault()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') open(bar.id);
                }}
                sx={{
                  position: 'absolute',
                  top: HEADER + 4 + rows.get(bar.id)! * ROW,
                  left: left + 2,
                  width: width - 4,
                  height: ROW - 8,
                  borderRadius: 1,
                  bgcolor: `${color}`,
                  color: 'rgba(0, 0, 0, 0.78)',
                  boxShadow: dragging ? 6 : 0,
                  zIndex: dragging ? 3 : 2,
                  display: 'flex',
                  alignItems: 'center',
                  px: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: prefs.fit ? 'hidden' : 'visible',
                  textOverflow: 'ellipsis',
                  cursor: canEdit ? 'grab' : 'pointer',
                  // A finger scrolls across bars too; holding one picks it up.
                  touchAction: drag?.id === bar.id ? 'none' : 'pan-x pan-y',
                  WebkitTouchCallout: 'none',
                  userSelect: 'none',
                  '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
                }}
              >
                {/* A title too long for its bar: inside when fitted (cut short), else beside it. */}
                {prefs.fit || title.length * 7.5 + 16 <= width - 4 ? (
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {title}
                  </Box>
                ) : (
                  <Box
                    component="span"
                    sx={{
                      position: 'absolute',
                      left: '100%',
                      ml: 0.75,
                      color: 'text.primary',
                      fontWeight: 500,
                      pointerEvents: 'none',
                    }}
                  >
                    {title}
                  </Box>
                )}
                {canEdit &&
                  (['start', 'end'] as const).map((part) => (
                    <Box
                      key={part}
                      aria-hidden
                      data-timeline-grip={part}
                      onPointerDown={(event) => press(event, original, part)}
                      sx={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        [part === 'start' ? 'left' : 'right']: 0,
                        width: GRIP,
                        cursor: 'ew-resize',
                        borderRadius: 1,
                        '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.15)' },
                      }}
                    />
                  ))}
              </Box>
            );
          })}
          {bars.length === 0 && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ position: 'sticky', left: 16, top: HEADER + 8, px: 2, pt: 1 }}
            >
              {t('timeline.empty')}
            </Typography>
          )}
        </Box>
      </Box>

      {undated.length > 0 && (
        <GroupSection
          groupKey="timeline:undated"
          title={t('timeline.undated')}
          count={undated.length}
        >
          <TaskTree tasks={undated} />
        </GroupSection>
      )}
    </Box>
  );
}
