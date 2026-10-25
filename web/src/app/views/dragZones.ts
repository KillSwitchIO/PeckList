// Where a dragged task may land in a view's groups (spec: PL-014, R-FB-58): what each group stands
// for when a task is dropped into it.

import { addDays } from '../../core/dates.ts';
import type { DateGroup } from '../../core/filters.ts';
import type { DragZone } from '../tasks/TaskTree.tsx';

/** What dropping a task into a priority, tag or list group does (by the group's key). */
export function groupZone(key: string): DragZone {
  const [kind, value = ''] = key.split(':') as [string, string?];
  if (kind === 'priority') return { group: { kind: 'priority', value } };
  if (kind === 'tag') return { group: { kind: 'tag', value } };
  if (kind === 'list') return { group: { kind: 'list', value } };
  return { group: null };
}

/** What dropping a task into a date group does: its day, its span of days, or no date. */
export function dateZone(group: DateGroup, today: string): DragZone {
  switch (group.key) {
    case 'overdue':
      return { group: null };
    case 'today':
    case 'tomorrow':
      return { group: { kind: 'date', value: group.date! } };
    case 'week':
      return { group: { kind: 'date', value: addDays(today, 2), until: addDays(today, 7) } };
    case 'later':
      return { group: { kind: 'date', value: addDays(today, 8), until: '9999-12-31' } };
    case 'none':
      return { group: { kind: 'date', value: 'none' } };
  }
}
