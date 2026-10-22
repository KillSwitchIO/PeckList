import type { ComponentType } from 'react';
import type { CalendarItem, CalendarPlacement } from '../core/calendar.ts';

export type CalendarMode = 'month' | 'week' | 'day';

export interface CalendarViewProps {
  mode: CalendarMode;
  /** A day in the period to show (`YYYY-MM-DD`). */
  date: string;
  /** What to draw (core/calendar.ts): schedules and due flags, times on the viewer's clock. */
  items: CalendarItem[];
  /** 0 Sunday, 1 Monday. */
  weekStart: 0 | 1;
  clock: '12h' | '24h';
  /** The days now in view, first and last (inclusive), so the page can feed the right items. */
  onRange: (from: string, to: string) => void;
  onOpen: (taskId: string) => void;
  /** An item was moved or resized; all-day ends are inclusive, null for one day. */
  onPlace: (taskId: string, placement: CalendarPlacement, resized: boolean) => void;
  /** A task from the outside (`[data-task-id]` in `dragSource`) was dropped on a day or a time. */
  onDrop: (taskId: string, day: string, time: string | null) => void;
  /** Where tasks to drag in live: elements with `data-task-id` and `data-title` inside it. */
  dragSource: HTMLElement | null;
}

/**
 * Month, week and day calendar (spec: Calendar rendering). Swap the library behind it by adding
 * an adapter that passes `app/calendar/calendarView.contract.tsx`.
 */
export type CalendarView = ComponentType<CalendarViewProps>;
