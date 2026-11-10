import { t } from './i18n/i18n.ts';

/**
 * Copies `text` to the clipboard. `navigator.clipboard` exists only on HTTPS and `localhost`, so a
 * server opened at `http://192.168.1.20` or `http://nas` has none: then, or when it refuses, the
 * text goes through a hidden text box and `document.execCommand('copy')`. That one works only
 * during the click, so it runs before anything is awaited when there is no clipboard API. `near`
 * is the button clicked: the box goes beside it, inside any open dialog, whose focus trap would
 * otherwise pull focus back before the copy. False when nothing was copied.
 */
export async function copyText(text: string, near?: Element | null): Promise<boolean> {
  const clipboard = (navigator as Partial<Navigator>).clipboard;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Not allowed here (no focus, a policy): try the old way.
    }
  }
  return copyThroughTextBox(text, near);
}

function copyThroughTextBox(text: string, near?: Element | null): boolean {
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  // Not aria-hidden: it takes focus for a moment, and hidden things must not (axe). Out of the tab
  // order, and gone again within the click.
  box.tabIndex = -1;
  Object.assign(box.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  const before = document.activeElement;
  (near?.parentElement ?? document.body).append(box);
  try {
    box.focus({ preventScroll: true });
    box.select();
    box.setSelectionRange(0, text.length);
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    box.remove();
    focusBack(before, near);
  }
}

/**
 * Focus back where it was, or on the button: Safari does not focus a button it clicks, so focus
 * was on the page, and in a dialog it would rest there until the focus trap's next look.
 */
function focusBack(before: Element | null, near: Element | null | undefined): void {
  const dialog = near?.closest('[role="dialog"]');
  const elsewhere =
    !(before instanceof HTMLElement) ||
    before === document.body ||
    (dialog !== null && dialog !== undefined && !dialog.contains(before));
  const back = elsewhere && near instanceof HTMLElement ? near : before;
  if (back instanceof HTMLElement) back.focus({ preventScroll: true });
}

/** Selects all of a field's text (an input, or any element), so the person can copy it by hand. */
export function selectForCopy(field: Element | null | undefined): void {
  if (!field) return;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    field.focus({ preventScroll: true });
    field.select();
    return;
  }
  window.getSelection()?.selectAllChildren(field);
}

/**
 * Copies `text`, or when the browser lets nothing copy it, selects `field` for a copy by hand:
 * 'copied' or 'manual', never nothing. Show `CopyByHand` on 'manual'.
 */
export async function copyOrSelect(
  text: string,
  field: Element | null | undefined,
  near?: Element | null,
): Promise<'copied' | 'manual'> {
  if (await copyText(text, near)) return 'copied';
  selectForCopy(field);
  return 'manual';
}

/** What to press to copy the selected text here. */
export function copyByHandText(): string {
  const touch =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (touch) return t('copy.hold');
  const mac = /Mac OS X|Macintosh/.test(navigator.userAgent);
  return t('copy.press', { keys: mac ? '⌘C' : 'Ctrl+C' });
}
