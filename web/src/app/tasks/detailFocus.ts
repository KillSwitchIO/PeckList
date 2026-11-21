/**
 * Where the keyboard goes as the task details open and close (QA's keyboard pass, 2026-11-20): it
 * fell to the page each time, so a keyboard user had to tab through the whole list to reach the
 * details, and lost their row on closing them.
 */

/** How long a keyboard open counts for the details it opens (they mount at once). */
const FRESH_MS = 1000;

/** The task a keyboard last opened from its row, and when. */
let keyboardOpened: { taskId: string; at: number } | null = null;

/**
 * A task row was opened: `keyboard` when by Enter or Space (a click with no pointer behind it).
 * A pointer leaves the keyboard where it was: on a phone, a focused title brings the keyboard up.
 */
export function openedFromRow(taskId: string, keyboard: boolean): void {
  keyboardOpened = keyboard ? { taskId, at: Date.now() } : null;
}

/** Whether the details of `taskId`, opening now, were opened by keyboard from its row. */
export function keyboardOpen(taskId: string): boolean {
  return keyboardOpened?.taskId === taskId && Date.now() - keyboardOpened.at < FRESH_MS;
}

/** The copy just made by Duplicate (PL-139), and when: it opens with its title selected. */
let copied: { taskId: string; at: number } | null = null;

/** `taskId` is a copy about to open: its title takes the keyboard, all selected. */
export function openingCopy(taskId: string): void {
  copied = { taskId, at: Date.now() };
}

/** Whether the details of `taskId`, opening now, are a copy just made. */
export function freshCopy(taskId: string): boolean {
  return copied?.taskId === taskId && Date.now() - copied.at < FRESH_MS;
}

/** How long the row is followed after the details close, while the list settles. */
export const SETTLE_MS = 800;

/** Stops following the last row, if it still is. */
let stopFollowing: (() => void) | null = null;

/**
 * The keyboard back on the task's row once its details have closed, unless it has gone somewhere
 * of its own since (only from the page, or from what closing took away).
 *
 * Closing can rebuild the rows: the list grows wider and draws them on one line instead of two,
 * so the row just focused is replaced and the focus drops to the page (QA, 2026-11-20, on every
 * engine; jsdom draws nothing, so its tests never saw it). For a moment after, the row is followed:
 * whenever the rows change or the focus moves elsewhere, it goes back to the task's row as it now
 * is, until the person presses a key or a pointer, or the moment is over.
 */
export function focusRow(taskId: string): void {
  stopFollowing?.();
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const row = () =>
    [...document.querySelectorAll<HTMLElement>('main [data-task-row]')].find(
      (each) => each.dataset.taskRow === taskId,
    );
  const place = () => {
    const now = row();
    if (now && document.activeElement !== now) now.focus();
  };
  place();

  const observer = new MutationObserver(place);
  const main = document.querySelector('main');
  if (main) observer.observe(main, { childList: true, subtree: true });
  const stop = () => {
    observer.disconnect();
    document.removeEventListener('focusin', place, true);
    document.removeEventListener('keydown', stop, true);
    document.removeEventListener('pointerdown', stop, true);
    window.clearTimeout(timer);
    if (stopFollowing === stop) stopFollowing = null;
  };
  document.addEventListener('focusin', place, true);
  // The person moving on is theirs to decide: the next key or press ends it.
  document.addEventListener('keydown', stop, true);
  document.addEventListener('pointerdown', stop, true);
  const timer = window.setTimeout(stop, SETTLE_MS);
  stopFollowing = stop;
}
