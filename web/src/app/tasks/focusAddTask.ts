/** Focus the page's add-task field, if it has one; false when it has none. */
export function focusAddTask(): boolean {
  const field = document.querySelector<HTMLElement>('[data-add-task]');
  if (!field) return false;
  field.focus();
  // On a phone the field may be scrolled away, and the keyboard is about to cover half the screen.
  field.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  return true;
}
