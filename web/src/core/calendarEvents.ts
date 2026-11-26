// Events of the person's shown calendars beside their tasks (spec: PL-134, decision 2: "events show
// as events"). The server sends each occurrence as the calendar has it; this places it on the
// viewer's days and clock, the way tasks are placed, so every view reads the same answer.

import { addMinutes, type CalendarItem } from './calendar.ts';
import { addDays, datePart, monthOf, shiftZone, timePart } from './dates.ts';
import { ensureContrast, WCAG_UI } from './palette.ts';

/**
 * One occurrence of a shown calendar's event. `start` and `end` are as the calendar has them:
 * `YYYY-MM-DD` all day (the end is the day after the last, as calendars keep it) or
 * `YYYY-MM-DDTHH:mm` in `timeZone` (null: a floating time, read as the viewer's). The title and
 * notes are text from outside: anyone who can send an invite can write them, so never markup.
 */
export interface ShownEvent {
  /** Opaque: the same event on every day it shows. */
  id: string;
  linkId: string;
  /** The day of this occurrence, `YYYY-MM-DD`. */
  occurrence: string;
  title: string;
  notes: string;
  start: string;
  end: string | null;
  allDay: boolean;
  timeZone: string | null;
  recurring: boolean;
  /** Single events on writable calendars; repeating ones are read-only for now. */
  editable: boolean;
  color: string | null;
}

/** An event placed for the viewer: on their clock, with the days it covers. */
export interface PlacedEvent {
  event: ShownEvent;
  /** This occurrence, unique among everything shown (`id|occurrence`). */
  key: string;
  /** `YYYY-MM-DD` all day, else the viewer's wall clock `YYYY-MM-DDTHH:mm`. */
  start: string;
  /** All day: the last day, inclusive (null for one day). Timed: when it ends. */
  end: string | null;
  allDay: boolean;
  /** The first and last day it shows on. */
  first: string;
  last: string;
}

/** A timed event with no end lasts this long (spec: PL-134, decision 5). */
export const EVENT_MINUTES = 30;

/** The colour an event takes when its calendar has none. */
export const EVENT_COLOR = '#7A8CA5';

/**
 * A calendar's colour as drawn on `surface`: its own, darkened (light theme) or lightened (dark
 * theme) just enough to stand out as a part of the page, 3:1 (QA, PL-134: a near-black calendar
 * vanished in dark, a pale yellow one in light).
 */
export function eventInk(color: string | null, surface: string): string {
  try {
    return ensureContrast(color ?? EVENT_COLOR, surface, WCAG_UI);
  } catch {
    // Not a #rrggbb colour (the server sends only those): the default one.
    return EVENT_COLOR;
  }
}

/** The key of one occurrence: what a hide holds on to until the server has it. */
export function eventKey(event: Pick<ShownEvent, 'id' | 'occurrence'>): string {
  return `${event.id}|${event.occurrence}`;
}

/** One event on the viewer's days and clock. */
export function placeEvent(event: ShownEvent, zone: string): PlacedEvent {
  const key = eventKey(event);
  if (event.allDay || timePart(event.start) === null) {
    const first = datePart(event.start);
    // Calendars end all-day events on the day after; a missing or odd end is one day.
    const after = event.end ? datePart(event.end) : null;
    const last = after && after > first ? addDays(after, -1) : first;
    return {
      event,
      key,
      start: first,
      end: last === first ? null : last,
      allDay: true,
      first,
      last,
    };
  }
  const from = event.timeZone ?? zone;
  const start = shiftZone(event.start, from, zone);
  const given = event.end && timePart(event.end) !== null ? shiftZone(event.end, from, zone) : null;
  const end = given && given > start ? given : addMinutes(start, EVENT_MINUTES);
  // Ending at midnight is ending on the day before.
  const last = timePart(end) === '00:00' ? addDays(datePart(end), -1) : datePart(end);
  const first = datePart(start);
  return { event, key, start, end, allDay: false, first, last: last < first ? first : last };
}

/**
 * The events to show, placed, without any held back (hidden and waiting on Undo), each occurrence
 * once even when two fetched months both hold it, all-day ones first and then by start.
 */
export function placeEvents(
  events: readonly ShownEvent[],
  zone: string,
  hidden: ReadonlySet<string> = new Set(),
): PlacedEvent[] {
  const seen = new Map<string, PlacedEvent>();
  for (const event of events) {
    const key = eventKey(event);
    if (hidden.has(key) || seen.has(key)) continue;
    seen.set(key, placeEvent(event, zone));
  }
  return [...seen.values()].sort(byStart);
}

function byStart(a: PlacedEvent, b: PlacedEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.event.title.localeCompare(b.event.title);
}

/** The placed events that touch any day from `from` to `to` (inclusive), in order. */
export function eventsBetween(
  placed: readonly PlacedEvent[],
  from: string,
  to: string,
): PlacedEvent[] {
  return placed.filter((each) => each.last >= from && each.first <= to);
}

/** The calendar views' items for the placed events touching `from` to `to`. Never movable. */
export function eventItems(
  placed: readonly PlacedEvent[],
  from: string,
  to: string,
): CalendarItem[] {
  return eventsBetween(placed, from, to).map((each) => ({
    id: `event:${each.key}`,
    taskId: '',
    kind: 'event',
    title: each.event.title,
    start: each.start,
    end: each.end,
    allDay: each.allDay,
    color: each.event.color ?? EVENT_COLOR,
    priority: 0,
    done: false,
    movable: false,
    eventKey: each.key,
  }));
}

/**
 * The months (`YYYY-MM`) to fetch so every event touching `from` to `to` arrives: a day either
 * side too, since an event late on one calendar day can fall on the next day of the viewer's.
 */
export function monthsCovering(from: string, to: string): string[] {
  const months: string[] = [];
  const last = monthOf(addDays(to, 1));
  for (let month = monthOf(addDays(from, -1)); month <= last;) {
    months.push(month);
    month = monthOf(addDays(`${month}-28`, 7));
  }
  return months;
}

/** A month's first and last day. */
export function monthDays(month: string): { from: string; to: string } {
  const next = monthOf(addDays(`${month}-28`, 7));
  return { from: `${month}-01`, to: addDays(`${next}-01`, -1) };
}
