// Where calendar items go on screen (spec: PL-093): which day lists what and in what order, and
// how timed tasks that overlap share a day's column. Pure; the calendar views draw the result.

import type { CalendarItem } from './calendar.ts';
import { addDays, datePart, daysBetween, timePart, weekday } from './dates.ts';

/** The fewest and most days the Days view shows side by side. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 14;

/** The first day of the week holding `date` (weeks start on `weekStart`, 0 Sunday). */
export function weekStartOf(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/** `count` days from `start`. */
export function daysFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

/** Minutes since midnight of a `YYYY-MM-DDTHH:mm` (0 for a date alone). */
export function minutesOf(value: string): number {
  const time = timePart(value);
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** `YYYY-MM-DDTHH:mm` for minutes into `day` (0 to 1440; 1440 is the next midnight). */
export function atMinutes(day: string, minutes: number): string {
  const whole = Math.max(0, Math.min(1440, Math.round(minutes)));
  const date = whole === 1440 ? addDays(day, 1) : day;
  const rest = whole % 1440;
  return `${date}T${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
}

/** Minutes to the nearest `step`. */
export function snap(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step;
}

/** The days an item shows on, first to last. */
function daysOf(item: CalendarItem): { first: string; last: string } {
  const first = datePart(item.start);
  if (!item.end) return { first, last: first };
  if (item.allDay) return { first, last: datePart(item.end) };
  // A timed item ending at midnight does not reach into that day.
  const last = minutesOf(item.end) === 0 ? addDays(datePart(item.end), -1) : datePart(item.end);
  return { first, last: last < first ? first : last };
}

/** How a day lists its items: all day (longer spans first), then by time, then due flags. */
function order(a: CalendarItem, b: CalendarItem): number {
  const rank = (item: CalendarItem) => (item.kind === 'due' ? 2 : item.allDay ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 0) {
    const span = (item: CalendarItem) => {
      const { first, last } = daysOf(item);
      return daysBetween(first, last);
    };
    if (span(a) !== span(b)) return span(b) - span(a);
  }
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/**
 * The items on each day they touch, in the order a day lists them: a span shows on every day it
 * covers, a timed task past midnight on both days. Only days from `from` to `to` are filled.
 */
export function itemsByDay(
  items: readonly CalendarItem[],
  from: string,
  to: string,
): Map<string, CalendarItem[]> {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const { first, last } = daysOf(item);
    const start = first < from ? from : first;
    const end = last > to ? to : last;
    for (let day = start; day <= end; day = addDays(day, 1)) {
      const list = byDay.get(day);
      if (list) list.push(item);
      else byDay.set(day, [item]);
    }
  }
  for (const list of byDay.values()) list.sort(order);
  return byDay;
}

/** Whether an item started before `day` (it continues from the day before). */
export function continuesFrom(item: CalendarItem, day: string): boolean {
  return datePart(item.start) < day;
}

/** One timed item's place in a day's column. */
export interface TimedBlock {
  item: CalendarItem;
  /** Minutes into the day it starts and ends (cut at midnight when it runs over). */
  top: number;
  bottom: number;
  /** Side by side with the ones it overlaps: which column, of how many. */
  column: number;
  columns: number;
  /** Which run of overlapping items it is in (counted from the morning) */
  group: number;
}

/** The shortest a block is drawn, so a point in time can still be read and grabbed. */
export const MIN_BLOCK_MINUTES = 20;

/**
 * A day's timed items laid out: each gets the time it covers on that day, and ones that overlap
 * share the width, in as few columns as they need (a group of overlapping items has one count).
 */
export function timedBlocks(items: readonly CalendarItem[], day: string): TimedBlock[] {
  const placed = items
    .filter((item) => !item.allDay && item.kind === 'schedule')
    .map((item) => {
      const top = datePart(item.start) < day ? 0 : minutesOf(item.start);
      const end = item.end ?? item.start;
      const bottom = datePart(end) > day ? 1440 : minutesOf(end);
      return {
        item,
        top,
        bottom: Math.max(bottom, top + MIN_BLOCK_MINUTES),
        column: 0,
        columns: 1,
        group: 0,
      };
    })
    .sort(
      (a, b) => a.top - b.top || b.bottom - a.bottom || a.item.title.localeCompare(b.item.title),
    );

  let group: typeof placed = [];
  let groupEnd = -1;
  let groups = 0;
  const close = () => {
    const count = Math.max(1, ...group.map((block) => block.column + 1));
    for (const block of group) {
      block.columns = count;
      block.group = groups;
    }
    groups += 1;
    group = [];
  };
  for (const block of placed) {
    if (block.top >= groupEnd && group.length > 0) close();
    // The first column whose last block has ended.
    const taken = new Set(
      group.filter((other) => other.bottom > block.top).map((other) => other.column),
    );
    let column = 0;
    while (taken.has(column)) column += 1;
    block.column = column;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.bottom);
  }
  if (group.length > 0) close();
  return placed;
}
