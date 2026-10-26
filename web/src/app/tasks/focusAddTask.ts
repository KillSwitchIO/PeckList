/** Focus the page's add-task field, if it has one; false when it has none. */
export function focusAddTask(): boolean {
  const field = document.querySelector<HTMLElement>('[data-add-task]');
  if (!field) return false;
  field.focus();
  // On a phone the field may be scrolled away, and the keyboard is about to cover half the screen.
  field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  return true;
}

/**
 * Open the new task screen of the page's add-task field (its expand button: a blank task, full
 * screen, with the page's defaults); false when the page has none.
 */
export function expandAddTask(): boolean {
  const button = document.querySelector<HTMLElement>('[data-add-task-expand]');
  if (!button) return false;
  button.click();
  return true;
}
