/**
 * Android's Back button inside the app (ADR-0017). The shell asks `window.pecklistBack()` first
 * (`punchlistBack` in an APK from before the rename); true means the app used it. Otherwise the
 * shell goes back in the WebView or leaves the app.
 */

/** The topmost open menu, dialog, popover or drawer (MUI renders each as a modal). */
function topModal(): HTMLElement | null {
  const open = [...document.querySelectorAll<HTMLElement>('.MuiModal-root')].filter(
    (each) => !each.classList.contains('MuiModal-hidden'),
  );
  return open.at(-1) ?? null;
}

/** Close the topmost popup (they all close on Escape), else step back in the app. */
export function handleBack(): boolean {
  const modal = topModal();
  if (modal) {
    const focused = document.activeElement;
    const target = focused instanceof HTMLElement && modal.contains(focused) ? focused : modal;
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    return true;
  }
  // React Router counts this tab's entries in history.state.idx: back while there is one, so an
  // open task (?task=) closes and pages go back the way they came.
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  if (typeof index === 'number' && index > 0) {
    window.history.back();
    return true;
  }
  return false;
}

declare global {
  interface Window {
    pecklistBack?: () => boolean;
    /** The same, for an APK from before the rename (PL-127). */
    punchlistBack?: () => boolean;
  }
}

export function installBackHandler(): void {
  window.pecklistBack = handleBack;
  window.punchlistBack = handleBack;
}
