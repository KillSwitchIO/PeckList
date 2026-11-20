// Whether this start of the app came to add a task: the Add task shortcut, a widget, voice or
// shared text (?add=1, useAddFromAddress). Such a start leaves Android's own dialogs (the
// notification and background asks) for the next one: a dialog takes the window's focus, so the
// keyboard the person asked for went down, and the page waited behind it (QA, first start after
// an install).

let added = false;

/** This start came to add a task. */
export function noteAddFromOutside(): void {
  added = true;
}

/**
 * Whether this start came to add a task. The address counts too while it still has ?add=1 (only
 * the app frame takes it off), so the answer does not depend on which ran first.
 */
export function addedFromOutside(): boolean {
  return added || new URLSearchParams(window.location.search).get('add') === '1';
}

/** Tests: a fresh start. */
export function forgetAddFromOutside(): void {
  added = false;
}
