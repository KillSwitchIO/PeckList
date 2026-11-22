// The words blocked-by links show (PL-055): the details rows' summaries and the chain mark's.

import type { Task } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';

export const titleOf = (task: Task) => task.title || t('task.untitled');

/** "Buy paint", "Buy paint and 2 more", or the count of tasks this device can't see. */
export function summary(titles: string[], hidden: number): string {
  const [first] = titles;
  if (first === undefined) return t('blocking.hidden', { count: hidden });
  return t('blocking.summary', { title: first, count: titles.length - 1 + hidden });
}

/** The words for a blocked task's chain mark: what it waits on, and a date that comes too soon. */
export function waitingText(waiting: Task[], late: Task[]): string {
  const [first] = waiting;
  if (!first) return '';
  const words = t('blocking.waitingOn', { title: titleOf(first), count: waiting.length - 1 });
  const [early] = late;
  return early ? `${words}. ${t('blocking.startsTooSoon', { title: titleOf(early) })}` : words;
}
