import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyOrSelect, copyText } from './copy.ts';

/** What `document.execCommand('copy')` saw when it ran: the focused box, its text and selection. */
interface Seen {
  tag: string | undefined;
  text: string | undefined;
  selected: [number | null, number | null] | undefined;
  parent: Element | null | undefined;
  ariaHidden: string | null | undefined;
}

let seen: Seen[] = [];

function execCommandAnswers(answer: boolean | Error) {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn((command: string) => {
      expect(command).toBe('copy');
      const box = document.activeElement as HTMLTextAreaElement | null;
      seen.push({
        tag: box?.tagName,
        text: box?.value,
        selected: box ? [box.selectionStart, box.selectionEnd] : undefined,
        parent: box?.parentElement,
        ariaHidden: box?.getAttribute('aria-hidden'),
      });
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  });
}

function clipboardIs(clipboard: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
}

let button: HTMLButtonElement;

beforeEach(() => {
  seen = [];
  document.body.innerHTML =
    '<div id="dialog"><input id="field" value="sam"><button>Copy</button></div>';
  button = document.querySelector('button')!;
  button.focus();
});

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
  delete (document as { execCommand?: unknown }).execCommand;
});

describe('copyText', () => {
  it('uses the clipboard API when there is one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboardIs({ writeText });
    execCommandAnswers(true);
    expect(await copyText('a link', button)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('a link');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('copies through a hidden box beside the button when there is no clipboard API (plain http)', async () => {
    clipboardIs(undefined);
    execCommandAnswers(true);
    expect(await copyText('http://nas/f/BEN', button)).toBe(true);
    expect(seen).toEqual([
      {
        tag: 'TEXTAREA',
        text: 'http://nas/f/BEN',
        selected: [0, 'http://nas/f/BEN'.length],
        parent: document.getElementById('dialog'),
        // It holds focus for that moment, so it is not hidden from screen readers (axe).
        ariaHidden: null,
      },
    ]);
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('gives focus to the button when the click left it on the page (Safari)', async () => {
    clipboardIs(undefined);
    execCommandAnswers(true);
    button.blur();
    expect(document.activeElement).toBe(document.body);
    expect(await copyText('a token', button)).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('keeps focus inside the dialog: back where it was there, else on the button', async () => {
    clipboardIs(undefined);
    execCommandAnswers(true);
    const dialog = document.getElementById('dialog')!;
    dialog.setAttribute('role', 'dialog');
    const field = document.getElementById('field') as HTMLInputElement;
    field.focus();
    await copyText('a token', button);
    expect(document.activeElement).toBe(field);

    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    await copyText('a token', button);
    expect(document.activeElement).toBe(button);
  });

  it('falls back to the hidden box when the clipboard API refuses', async () => {
    clipboardIs({
      writeText: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')),
    });
    execCommandAnswers(true);
    expect(await copyText('a token', button)).toBe(true);
    expect(seen.map((s) => s.text)).toEqual(['a token']);
  });

  it('says so when neither way copies, or the old way throws', async () => {
    clipboardIs(undefined);
    execCommandAnswers(false);
    expect(await copyText('x', button)).toBe(false);
    execCommandAnswers(new Error('not supported'));
    expect(await copyText('x', button)).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('copyOrSelect', () => {
  it('selects the field for a copy by hand when nothing copies', async () => {
    clipboardIs(undefined);
    execCommandAnswers(false);
    const field = document.getElementById('field') as HTMLInputElement;
    expect(await copyOrSelect('sam', field, button)).toBe('manual');
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
  });

  it('selects the text of a field that is not an input', async () => {
    clipboardIs(undefined);
    execCommandAnswers(false);
    const shown = document.createElement('div');
    shown.textContent = 'a-new-password';
    document.body.append(shown);
    expect(await copyOrSelect('a-new-password', shown, button)).toBe('manual');
    expect(window.getSelection()?.toString()).toBe('a-new-password');
  });

  it('selects nothing when it copied', async () => {
    clipboardIs(undefined);
    execCommandAnswers(true);
    const field = document.getElementById('field') as HTMLInputElement;
    expect(await copyOrSelect('sam', field, button)).toBe('copied');
    expect(document.activeElement).toBe(button);
  });
});
