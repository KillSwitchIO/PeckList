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

/** Whether a dialog, menu, popover or sheet is open (they handle Escape themselves). */
export function popupOpen(): boolean {
  return document.querySelector('.MuiModal-root:not(.MuiModal-hidden)') !== null;
}
