import type { KeyboardEvent } from 'react';

const isShiftEnter = (event: KeyboardEvent) =>
  event.key === 'Enter' && event.shiftKey && !event.nativeEvent.isComposing;

/** Shift+Return confirms a dialog's form (like its OK button). */
export function submitOnShiftEnter(event: KeyboardEvent<HTMLFormElement>) {
  if (!isShiftEnter(event)) return;
  event.preventDefault();
  event.currentTarget.requestSubmit();
}

/** Shift+Return runs `action` (a picker's OK). */
export function onShiftEnter(action: () => void) {
  return (event: KeyboardEvent) => {
    if (!isShiftEnter(event)) return;
    event.preventDefault();
    action();
  };
}

/** Whether the user is typing: a text field, an editor, or a select has focus. */
export function typing(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return (
    active.isContentEditable ||
    // (jsdom and some embedded views lack isContentEditable)
    active.closest('[contenteditable]:not([contenteditable="false"])') !== null ||
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  );
}

/** Whether a dialog, menu, popover or sheet is open (they handle Escape themselves). */
export function popupOpen(): boolean {
  return document.querySelector('.MuiModal-root:not(.MuiModal-hidden)') !== null;
}
