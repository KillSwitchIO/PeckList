// What one change in a task's history says (R-FB-105), TickTick style: "changed the date to Fri,
// Oct 30". Values arrive as the field's JSON; names (lists, people, tags) come from this device's
// copy of the data, so nothing private sits in the history beyond what the task holds.

import { getEntity } from '../../core/collections.ts';
import { describePrincipal } from '../../core/sharing.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import type { HistoryEntry } from '../../ports/sync.ts';
import { formatDay, formatWhen } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';

function parse(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** A schedule's or a due date's day (and time), or null. */
function when(value: unknown, today: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const at = (value as { start?: unknown; at?: unknown }).start ?? (value as { at?: unknown }).at;
  if (typeof at !== 'string') return null;
  return at.length > 10 ? formatWhen(at, today) : formatDay(at, today);
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];

export function historyText(entry: HistoryEntry, workspace: WorkspaceFile, today: string): string {
  const before = parse(entry.before);
  const after = parse(entry.after);
  const names = (principals: string[]) =>
    principals.map((principal) => describePrincipal(workspace, principal).name).join(', ');
  const tagNames = (ids: string[]) =>
    ids.map((id) => getEntity(workspace, 'tags', id)?.name ?? t('history.aTag')).join(', ');
  switch (entry.field) {
    case 'created':
      return t('history.created');
    case 'deleted':
      return t('history.deleted');
    case 'restored':
      return t('history.restored');
    case 'title':
      return typeof after === 'string' && after
        ? t('history.titleTo', { title: after })
        : t('history.title.changed');
    case 'status':
      return after === 'done'
        ? t('history.completed')
        : after === 'wontdo'
          ? t('history.wontDo')
          : t('history.reopened');
    case 'schedule': {
      const day = when(after, today);
      return day ? t('history.date', { date: day }) : t('history.dateRemoved');
    }
    case 'due': {
      const day = when(after, today);
      return day ? t('history.due', { date: day }) : t('history.dueRemoved');
    }
    case 'priority': {
      const level = typeof after === 'number' ? after : 0;
      return level === 1 || level === 2 || level === 3
        ? t('history.priority', { priority: t(`priority.${level}`) })
        : t('history.priorityRemoved');
    }
    case 'listId': {
      const list = typeof after === 'string' ? getEntity(workspace, 'lists', after) : undefined;
      return t('history.moved', { list: list ? listName(list, workspace) : t('history.aList') });
    }
    case 'parentId': {
      const parent = typeof after === 'string' ? getEntity(workspace, 'tasks', after) : undefined;
      return parent
        ? t('history.subtaskOf', { title: parent.title || t('task.untitled') })
        : t('history.ownTask');
    }
    case 'assignees': {
      const was = strings(before);
      const now = strings(after);
      const added = now.filter((each) => !was.includes(each));
      const removed = was.filter((each) => !now.includes(each));
      if (added.length && removed.length) {
        return t('history.reassigned', { added: names(added), removed: names(removed) });
      }
      if (added.length) return t('history.assigned', { people: names(added) });
      return t('history.unassigned', { people: names(removed) });
    }
    case 'tags': {
      const was = strings(before);
      const now = strings(after);
      const added = now.filter((each) => !was.includes(each));
      const removed = was.filter((each) => !now.includes(each));
      if (added.length && !removed.length) return t('history.tagged', { tags: tagNames(added) });
      if (removed.length && !added.length)
        return t('history.untagged', { tags: tagNames(removed) });
      return t('history.tags');
    }
    case 'notes':
      return t('history.notes');
    case 'recurrence':
      return after ? t('history.repeat') : t('history.repeatStopped');
    case 'reminders':
      return t('history.reminders');
    case 'progress':
      return t('history.progress', { percent: typeof after === 'number' ? after : 0 });
    case 'pinnedAt':
      return after ? t('history.pinned') : t('history.unpinned');
    default:
      return t('history.changed');
  }
}
