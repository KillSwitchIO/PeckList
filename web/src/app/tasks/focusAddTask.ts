/** Focus the page's add-task field, if it has one; false when it has none. */
export function focusAddTask(): boolean {
  const field = document.querySelector<HTMLElement>('[data-add-task]');
  if (!field) return false;
  field.focus();
  // On a phone the field may be scrolled away, and the keyboard is about to cover half the screen.
  field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  return true;
}

/** The event the add-task field takes a title from (`detail`: the text), for fillAddTask. */
export const ADD_TEXT_EVENT = 'pecklist:add-text';

/**
 * Put `text` in the page's add-task field, to check and add (text from outside the app, PL-113);
 * false when the page has none.
 */
export function fillAddTask(text: string): boolean {
  const field = document.querySelector<HTMLElement>('[data-add-task]');
  if (!field) return false;
  field.dispatchEvent(new CustomEvent(ADD_TEXT_EVENT, { detail: text }));
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
