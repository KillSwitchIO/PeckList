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
  useTheme,
} from '@mui/material';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { addBlocker, blockersOf, warns, wouldLoop } from '../../core/blocking.ts';
import { addDays, daysBetween, localTimeZone } from '../../core/dates.ts';
import {
  barBox,
  barOf,
  draggedSchedule,
  fitRows,
  linkPath,
  ownRows,
  type Bar,
} from '../../core/timeline.ts';
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
import { localeDateFormat } from '../../core/intl.ts';

const ROW = 34;
const HEADER = 44;
/** Room between a bar and its row's edges, and its days' edges */
const INSET = 4;
const SIDE = 2;
/** A title beside its bar starts this far past the bar's end */
const TITLE_GAP = 6;
/** ...or this far when an arrow leaves that end, so the arrow turns down clear of it (QA, PL-055) */
const LINKED_TITLE_GAP = 14;
/** The blocked-by handle past a bar's end: drawn small, pressed easily (PL-055) */
const LINK_HIT = 24;
/** The grip at each end of a bar, for stretching it. */
const GRIP = 10;
/** A press that moves this far is a drag, not a tap. */
const MOVE_PX = 5;
/** A finger holds a bar this long to pick it up; moving sooner scrolls (as the calendar). */
const HOLD_MS = 350;

const weekdayNarrow = localeDateFormat({ weekday: 'narrow', timeZone: 'UTC' });
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
  // A blocked-by link being drawn from a bar's handle (PL-055): where the pointer is, in the
  // drawing's pixels, and the bar under it (refused when linking would make a loop).
  const [linking, setLinking] = useState<{
    from: Id;
    x: number;
    y: number;
    target: Id | null;
    refused: boolean;
  } | null>(null);
  const drawing = useRef<HTMLDivElement>(null);
  // Ends a link being drawn: Escape, or the timeline going away mid-drag (a later let-go then
  // links nothing).
  const cancelLink = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelLink.current?.(), []);
  const theme = useTheme();
  const markers = useId();

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

  const geometry = { origin: from, day, row: ROW, header: HEADER, inset: INSET, side: SIDE };
  const barById = new Map(bars.map((bar) => [bar.id, bar]));
  const boxOf = (id: Id) => {
    const bar = shown(barById.get(id)!);
    return barBox(bar, rows.get(id)!, geometry);
  };
  /** A task as it shows, with a drag in progress applied (for the arrows' colour). */
  const current = (task: Task): Task =>
    drag?.id === task.id && task.schedule
      ? { ...task, schedule: draggedSchedule(task.schedule, drag.part, drag.days) }
      : task;
  const zone = localTimeZone();
  // Arrows between bars both on this timeline; a blocker elsewhere shows in the task's details.
  const links = dated.flatMap((waiting) =>
    blockersOf(workspace, waiting)
      .shown.filter((blocker) => barById.has(blocker.id) && barById.has(waiting.id))
      .map((blocker) => ({
        blocker,
        waiting,
        late: warns(current(waiting), current(blocker), zone),
      })),
  );
  /** A title too long for its bar (and not cut short in a fitted view) goes beside it. */
  const besideBar = (title: string, width: number) =>
    !prefs.fit && title.length * 7.5 + 16 > width - 4;
  const blocking = new Set(links.map(({ blocker }) => blocker.id));
  const titleGap = (id: Id) => (blocking.has(id) ? LINKED_TITLE_GAP : TITLE_GAP);
  // What an arrow should go round: every bar, and every title beside one (7.5 px a character, as
  // above, out from the bar's end).
  const obstacles = bars.flatMap((original) => {
    const bar = shown(original);
    const box = boxOf(bar.id);
    const title = byId.get(bar.id)!.title || t('task.untitled');
    const beside = besideBar(title, (daysBetween(bar.from, bar.to) + 1) * day)
      ? [
          {
            id: bar.id,
            bar: false,
            left: box.right + titleGap(bar.id),
            right: box.right + titleGap(bar.id) + title.length * 7.5,
            y: box.y,
          },
        ]
      : [];
    return [{ id: bar.id, bar: true, ...box }, ...beside];
  });
  /** The obstacles for one arrow: not the two bars it joins, though the blocker's own title is one. */
  const inTheWay = (blocker: Id, waiting: Id) =>
    obstacles.filter((box) => !box.bar || (box.id !== blocker && box.id !== waiting));
  const grey = theme.palette.text.disabled;
  const red = theme.palette.error.main;

  /** Draw a link from a bar's handle to the bar it is dropped on, which then waits on this one. */
  const startLink = (event: React.PointerEvent<HTMLElement>, fromId: Id) => {
    // Mouse and pen: a finger has the hold to move, and the task menu and details to link.
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.stopPropagation();
    event.preventDefault();
    const pointer = event.pointerId;
    const blocker = byId.get(fromId);
    const at = (next: PointerEvent) => {
      const box = drawing.current?.getBoundingClientRect();
      const hit = document.elementFromPoint?.(next.clientX, next.clientY);
      const onBar = hit?.closest<HTMLElement>('[data-timeline-bar]')?.dataset.timelineBar ?? null;
      const target = onBar && onBar !== fromId ? onBar : null;
      return {
        from: fromId,
        x: next.clientX - (box?.left ?? 0),
        y: next.clientY - (box?.top ?? 0),
        target,
        refused: target !== null && wouldLoop(workspace, target, fromId),
      };
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId === pointer) setLinking(at(next));
    };
    const escape = (key: KeyboardEvent) => {
      if (key.key === 'Escape') finish();
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', escape);
      cancelLink.current = null;
      setLinking(null);
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      const { target, refused } = at(next);
      finish();
      const waiting = target ? byId.get(target) : undefined;
      if (!waiting || refused || !blocker || waiting.blockedBy[fromId]?.in === true) return;
      apply(
        (ctx, ws) => addBlocker(ctx, ws, waiting.id, fromId),
        t('undo.blocked', { title: blocker.title || t('task.untitled') }),
      );
    };
    setLinking(at(event.nativeEvent));
    cancelLink.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', escape);
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
        <Box
          ref={drawing}
          sx={{ position: 'relative', width: count * day, height: HEADER + rowCount * ROW + 8 }}
        >
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
          {/* Blocked-by arrows (PL-055), under the bars: red where a task starts before its blocker
              ends. Drawn from the bars as they show, so they follow a drag. */}
          <Box
            component="svg"
            aria-hidden
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: count * day,
              height: HEADER + rowCount * ROW + 8,
              overflow: 'visible',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <defs>
              {(
                [
                  ['grey', grey],
                  ['red', red],
                ] as const
              ).map(([name, color]) => (
                <marker
                  key={name}
                  id={`${markers}-${name}`}
                  viewBox="0 0 6 6"
                  refX="5"
                  refY="3"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 0 L 6 3 L 0 6 z" fill={color} />
                </marker>
              ))}
            </defs>
            {links.map(({ blocker, waiting, late }) => (
              <path
                key={`${blocker.id}-${waiting.id}`}
                data-timeline-link={`${blocker.id} ${waiting.id}`}
                data-late={late ? 'true' : undefined}
                d={linkPath(
                  boxOf(blocker.id),
                  boxOf(waiting.id),
                  ROW,
                  inTheWay(blocker.id, waiting.id),
                )}
                fill="none"
                stroke={late ? red : grey}
                strokeWidth={late ? 2 : 1.5}
                markerEnd={`url(#${markers}-${late ? 'red' : 'grey'})`}
              />
            ))}
            {linking && barById.has(linking.from) && (
              <line
                data-timeline-linking
                x1={boxOf(linking.from).right}
                y1={boxOf(linking.from).y}
                x2={linking.x}
                y2={linking.y}
                stroke={linking.refused ? red : theme.palette.text.secondary}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
          </Box>
          {bars.map((original) => {
            const bar = shown(original);
            const task = byId.get(bar.id)!;
            const left = daysBetween(from, bar.from) * day;
            const width = (daysBetween(bar.from, bar.to) + 1) * day;
            const color = colorOf(task);
            const title = task.title || t('task.untitled');
            const dragging = drag?.id === bar.id;
            const target = linking?.target === bar.id;
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
                  zIndex: dragging || linking?.from === bar.id ? 3 : 2,
                  // The bar a link is dropped on: outlined, red when the link would make a loop.
                  ...(target && {
                    outline: 2,
                    outlineOffset: 2,
                    outlineColor: linking.refused ? 'error.main' : 'primary.main',
                  }),
                  display: 'flex',
                  alignItems: 'center',
                  px: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  // Visible always: the link handle sits past the bar's end. A fitted title is cut
                  // short by its own span.
                  overflow: 'visible',
                  // Under a link being drawn: whether it can be dropped here (QA: grab won before).
                  cursor: target
                    ? linking?.refused
                      ? 'not-allowed'
                      : 'copy'
                    : canEdit
                      ? 'grab'
                      : 'pointer',
                  // A finger scrolls across bars too; holding one picks it up.
                  touchAction: drag?.id === bar.id ? 'none' : 'pan-x pan-y',
                  WebkitTouchCallout: 'none',
                  userSelect: 'none',
                  '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
                  // The link handle shows on a hovered or focused bar (and the one being linked from).
                  '&:hover [data-timeline-link-handle], &:focus-visible [data-timeline-link-handle]':
                    {
                      opacity: 1,
                      pointerEvents: 'auto',
                    },
                }}
              >
                {/* A title too long for its bar: inside when fitted (cut short), else beside it. */}
                {!besideBar(title, width) ? (
                  <Box
                    component="span"
                    sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {title}
                  </Box>
                ) : (
                  <Box
                    component="span"
                    sx={{
                      position: 'absolute',
                      left: '100%',
                      ml: `${titleGap(bar.id)}px`,
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
                {canEdit && (
                  <Box
                    aria-hidden
                    data-timeline-link-handle={bar.id}
                    title={t('timeline.linkHandle')}
                    onPointerDown={(event) => startLink(event, bar.id)}
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      left: '100%',
                      width: LINK_HIT,
                      height: LINK_HIT,
                      transform: 'translate(2px, -50%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'crosshair',
                      opacity: linking?.from === bar.id ? 1 : 0,
                      pointerEvents: 'none',
                      // No hover on touch screens: no handle there.
                      '@media (hover: none)': { display: 'none' },
                      '&::after': {
                        content: '""',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: 'background.paper',
                        border: 2,
                        borderColor: 'text.secondary',
                      },
                    }}
                  />
                )}
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
