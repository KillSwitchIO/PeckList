// Reminders that fired on this device, for the notifications page (spec: PL-061). Kept in this
// browser only (the server learns of reminders once it sends them itself, step C).

const LOG_KEY = 'punchlist.reminderLog';
const KEEP = 50;
/** Fired when the log changes in this tab (other tabs hear the storage event). */
export const REMINDER_LOG_EVENT = 'punchlist:reminder-log';

export interface LoggedReminder {
  /** The reminder's key: task and time. */
  id: string;
  taskId: string;
  /** When it fired (ms). */
  at: number;
  read: boolean;
}

export function reminderLog(): LoggedReminder[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as LoggedReminder[];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function save(entries: LoggedReminder[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(0, KEEP)));
    window.dispatchEvent(new Event(REMINDER_LOG_EVENT));
  } catch {
    // Private windows: the page simply shows no reminders.
  }
}

export function logReminder(entry: Omit<LoggedReminder, 'read'>): void {
  save([{ ...entry, read: false }, ...reminderLog().filter((each) => each.id !== entry.id)]);
}

/** Mark some (null: all) read. */
export function readReminders(ids: string[] | null): void {
  save(
    reminderLog().map((each) =>
      ids === null || ids.includes(each.id) ? { ...each, read: true } : each,
    ),
  );
}

/** Clear some (null: all). */
export function clearReminders(ids: string[] | null): void {
  save(ids === null ? [] : reminderLog().filter((each) => !ids.includes(each.id)));
}
