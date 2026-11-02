// Deleting or moving a repeating task asks first, as TickTick does: just this date, or all of
// them (spec: PL-060). One dialog for the whole app (ThisOrAllHost, in AppProviders); anything
// can ask through `askThisOrAll` and wait for the answer.

import { datePart } from '../../core/dates.ts';
import { parseRule } from '../../core/recurrence.ts';
import type { Task } from '../../core/types.ts';

export type ThisOrAll = 'this' | 'all';

export interface ThisOrAllQuestion {
  title: string;
  message: string;
  thisLabel: string;
  allLabel: string;
}

export interface Asked extends ThisOrAllQuestion {
  answer: (choice: ThisOrAll | null) => void;
}

let show: ((asked: Asked | null) => void) | null = null;

/** The dialog that asks (ThisOrAllHost) says it is there, and gone. */
export function setAsker(next: ((asked: Asked | null) => void) | null): void {
  show = next;
}

/** Whether `asker` is the one asking now. */
export function isAsker(asker: (asked: Asked | null) => void): boolean {
  return show === asker;
}

/** Ask; null when the person backs out. With no dialog on screen to ask in, it is all of them. */
export function askThisOrAll(question: ThisOrAllQuestion): Promise<ThisOrAll | null> {
  const ask = show;
  if (!ask) return Promise.resolve('all');
  return new Promise((resolve) =>
    ask({
      ...question,
      answer: (choice) => {
        ask(null);
        resolve(choice);
      },
    }),
  );
}

/** Whether changing this task's date or deleting it asks this-or-all: an open repeating task. */
export function asksThisOrAll(task: Task): boolean {
  return (
    task.status === 'open' &&
    Boolean(task.schedule?.start ?? task.due?.at) &&
    parseRule(task.recurrence) !== null
  );
}

/** The date of the occurrence shown: the one opened (`on`, a date to come), or the task's own. */
export function shownOccurrence(task: Task, on: string | null): string | null {
  const anchor = task.schedule?.start ?? task.due?.at;
  if (!anchor) return null;
  const current = datePart(anchor);
  return on && on > current ? on : current;
}
