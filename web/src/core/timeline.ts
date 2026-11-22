// The timeline's sums (spec: PL-055, R-FB-56): where a task's bar runs, how bars share rows when
// fitted together, and what dragging a bar or its ends does to the task's dates.

import { addDays, datePart, daysBetween } from './dates.ts';
import type { Id, Schedule, Task } from './types.ts';

export interface Bar {
  id: Id;
  /** First and last day it covers, both included */
  from: string;
  to: string;
}

/** A dated task's bar: its start day to its end day (one day when it has no end). */
export function barOf(task: Task): Bar | null {
  if (!task.schedule) return null;
  const from = datePart(task.schedule.start);
  const end = task.schedule.end ? datePart(task.schedule.end) : from;
  return { id: task.id, from, to: end < from ? from : end };
}

/**
 * Rows for bars fitted together: each takes the first row free on its first day, so bars that do
 * not overlap share a row. Earlier bars first, longer first on the same day.
 */
export function fitRows(bars: readonly Bar[]): Map<Id, number> {
  const order = [...bars].sort(
    (a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to) || a.id.localeCompare(b.id),
  );
  const ends: string[] = [];
  const rows = new Map<Id, number>();
  for (const bar of order) {
    let row = ends.findIndex((end) => end < bar.from);
    if (row === -1) row = ends.length;
    ends[row] = bar.to;
    rows.set(bar.id, row);
  }
  return rows;
}

/**
 * Every bar on its own row, the one due first at the top and the last at the bottom (by its end,
 * then its start; R-FB-156): scrolling down goes forward in time, nothing scattered.
 */
export function ownRows(bars: readonly Bar[]): Map<Id, number> {
  const order = [...bars].sort(
    (a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from) || a.id.localeCompare(b.id),
  );
  return new Map(order.map((bar, index) => [bar.id, index]));
}

const shift = (value: string, days: number) => addDays(datePart(value), days) + value.slice(10);

/**
 * The schedule after a drag: the whole bar moved `days` (`move`), or one end moved (`start`,
 * `end`). Times of day stay; an end is never before the start; a span back to one day has no end.
 */
export function draggedSchedule(
  schedule: Schedule,
  part: 'move' | 'start' | 'end',
  days: number,
): Schedule {
  if (days === 0) return schedule;
  if (part === 'move') {
    return {
      ...schedule,
      start: shift(schedule.start, days),
      end: schedule.end ? shift(schedule.end, days) : null,
    };
  }
  const end = schedule.end ?? schedule.start;
  if (part === 'start') {
    const start = shift(schedule.start, days);
    const clamped =
      daysBetween(datePart(end), datePart(start)) > 0
        ? datePart(end) + schedule.start.slice(10)
        : start;
    return withEnd({ ...schedule, start: clamped }, end);
  }
  const moved = shift(end, days);
  const clamped =
    daysBetween(datePart(schedule.start), datePart(moved)) < 0
      ? datePart(schedule.start) + end.slice(10)
      : moved;
  return withEnd(schedule, clamped);
}

/** An all-day span ending on its start day has no end (it is one day). */
function withEnd(schedule: Schedule, end: string): Schedule {
  const oneDay = schedule.allDay && datePart(end) === datePart(schedule.start);
  return { ...schedule, end: oneDay ? null : end };
}

/** Where a bar sits on the drawing, in pixels: its left and right edges and its middle row line. */
export interface BarBox {
  left: number;
  right: number;
  y: number;
}

/** The sizes the timeline draws with. */
export interface TimelineGeometry {
  /** First day drawn */
  origin: string;
  /** Width of one day */
  day: number;
  /** Height of one row, and the room above the first one */
  row: number;
  header: number;
  /** Room left between a bar and its row's edges, and between a bar and its day's edges */
  inset: number;
  side: number;
}

/** A bar's box on the drawing (the same sums the bars are placed with). */
export function barBox(bar: Bar, rowIndex: number, geometry: TimelineGeometry): BarBox {
  const { origin, day, row, header, inset, side } = geometry;
  const left = daysBetween(origin, bar.from) * day + side;
  const width = (daysBetween(bar.from, bar.to) + 1) * day - side * 2;
  return { left, right: left + width, y: header + inset + rowIndex * row + (row - inset * 2) / 2 };
}

/**
 * The arrow for a blocked-by link (PL-055): out of the end of the blocker's bar, into the start of
 * the bar waiting on it. Room to go straight: out, down to the row, in. No room (the waiting task
 * starts before the blocker ends, or just after): out, down half a row, back left past the start,
 * then down and in, so the arrow never runs across the bars it joins.
 */
export function linkPath(from: BarBox, to: BarBox, row: number, gap = 8): string {
  const out = from.right + gap;
  if (to.left - gap >= out) {
    const turn = Math.max(out, to.left - gap);
    return `M ${from.right} ${from.y} H ${turn} V ${to.y} H ${to.left}`;
  }
  const between = from.y + (to.y >= from.y ? row / 2 : -row / 2);
  const back = to.left - gap;
  return `M ${from.right} ${from.y} H ${out} V ${between} H ${back} V ${to.y} H ${to.left}`;
}
