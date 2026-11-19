import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderThemed } from '../../test/renderApp.tsx';
import { openOutside } from '../smartLinks/openOutside.ts';
import TiptapEditor from './TiptapEditor.tsx';

// Smart links in the notes (PL-146). jsdom has no layout, so ProseMirror cannot tell where a
// mouse press lands; the clicks go to the editor's click handling directly, as ProseMirror would
// call it, with the event's target and pointer type set.

let opened: string[];

beforeEach(() => {
  opened = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    opened.push(this.href);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function notes(value: string) {
  const onCommit = vi.fn();
  renderThemed(
    <>
      <TiptapEditor label="Notes" value={value} onCommit={onCommit} />
      <button type="button">Elsewhere</button>
    </>,
  );
  const box = await screen.findByRole('textbox', { name: 'Notes' });
  const editor = (box as HTMLElement & { editor: Editor }).editor;
  return { box, editor, onCommit };
}

function smart(box: HTMLElement, kind: string): HTMLElement {
  const found = box.querySelector<HTMLElement>(`[data-smart="${kind}"]`);
  if (!found) throw new Error(`no ${kind} link`);
  return found;
}

/** A click on `element` as ProseMirror passes it on: mouse, or a finger with `touch`. */
function click(editor: Editor, element: HTMLElement, touch = false): boolean {
  const view = editor.view;
  const event = new MouseEvent('mouseup', { button: 0, clientX: 40, clientY: 30 });
  Object.defineProperty(event, 'target', { value: element });
  Object.defineProperty(event, 'pointerType', { value: touch ? 'touch' : 'mouse' });
  const pos = view.posAtDOM(element.firstChild ?? element, 1);
  return view.someProp('handleClick', (handle) => handle(view, pos, event)) ?? false;
}

describe('smart links in the notes', () => {
  it('shows numbers and addresses as links without changing the note', async () => {
    const value = 'Call 515-555-0123 about 123 Main St, Urbandale, IA 50322 today';
    const { box, editor, onCommit } = await notes(value);
    expect(smart(box, 'phone')).toHaveTextContent('515-555-0123');
    expect(smart(box, 'address')).toHaveTextContent('123 Main St, Urbandale, IA 50322');
    act(() => {
      editor.chain().focus('end').insertContent('!').run();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(`${value}!`);
  });

  it('an email in the notes is a mailto: link already, and offers email and copy', async () => {
    const { box, editor } = await notes('Ask sam@example.com today');
    expect(box.querySelector('[data-smart="email"]')).toBeNull();
    const link = box.querySelector<HTMLElement>('a[href="mailto:sam@example.com"]')!;
    click(editor, link);
    await screen.findByRole('menu', { name: 'sam@example.com' });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Email' }));
    expect(opened).toEqual(['mailto:sam@example.com']);
  });

  it('leaves code and the text of links alone', async () => {
    const { box } = await notes(
      '`515-555-0123` and [515-555-0111](https://example.com) 515-555-0199',
    );
    const phones = box.querySelectorAll('[data-smart="phone"]');
    expect([...phones].map((phone) => phone.textContent)).toEqual(['515-555-0199']);
  });

  it('follows the text as it is edited', async () => {
    const { box, editor } = await notes('Call');
    expect(box.querySelector('[data-smart]')).toBeNull();
    act(() => {
      editor.chain().focus('end').insertContent(' (515) 555-0123').run();
    });
    expect(smart(box, 'phone')).toHaveTextContent('(515) 555-0123');
  });

  it('a click with the mouse offers call, text and copy for a number', async () => {
    const { box, editor } = await notes('Call 515-555-0123');
    click(editor, smart(box, 'phone'));
    const menu = await screen.findByRole('menu', { name: '515-555-0123' });
    expect(menu).toBeInTheDocument();
    expect(opened).toEqual([]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Text' }));
    expect(opened).toEqual(['sms:5155550123']);
  });

  it('offers three maps for an address', async () => {
    const { box, editor } = await notes('At 42 W 5th Ave Apt 3B');
    click(editor, smart(box, 'address'));
    await screen.findByRole('menu');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open in Google Maps',
      'Open in Apple Maps',
      'Open in OpenStreetMap',
      'Copy',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open in OpenStreetMap' }));
    expect(opened).toEqual([
      `https://www.openstreetmap.org/search?query=${encodeURIComponent('42 W 5th Ave Apt 3B')}`,
    ]);
  });

  it('a tap does the main thing at once: the maps app on Android, the dialer for a number', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/142 Mobile Safari/537.36',
    );
    const { box, editor } = await notes('123 Main St, Urbandale, IA 50322 or (515) 555-0123');
    expect(click(editor, smart(box, 'address'), true)).toBe(true);
    expect(click(editor, smart(box, 'phone'), true)).toBe(true);
    expect(opened).toEqual([
      `geo:0,0?q=${encodeURIComponent('123 Main St, Urbandale, IA 50322')}`,
      'tel:5155550123',
    ]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a long press reported as a context menu offers open and copy, and copies the address', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { box } = await notes('See [the docs](https://docs.example.com/a)');
    const link = box.querySelector('a')!;
    // A right-click with the mouse keeps the browser's own menu.
    expect(fireEvent.contextMenu(link)).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(press, 'pointerType', { value: 'touch' });
    fireEvent(link, press);
    await screen.findByRole('menu', { name: 'https://docs.example.com/a' });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://docs.example.com/a');
    expect(await screen.findByRole('menuitem', { name: 'Copied' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('a long press with a finger offers the choices, and its click does not call', async () => {
    const { box, editor } = await notes('Call 515-555-0123');
    const phone = smart(box, 'phone');
    fireEvent.pointerDown(phone, { pointerType: 'touch', clientX: 40, clientY: 30 });
    await screen.findByRole('menu', { name: '515-555-0123' }, { timeout: 2000 });
    fireEvent.pointerUp(phone, { pointerType: 'touch' });
    expect(click(editor, phone, true)).toBe(true);
    expect(opened).toEqual([]);
  });

  it('while the notes are being edited, a tap or click only places the cursor', async () => {
    const { box, editor } = await notes('Call 515-555-0123');
    const phone = smart(box, 'phone');
    act(() => {
      editor.view.focus();
    });
    fireEvent.pointerDown(phone, { pointerType: 'touch' });
    expect(click(editor, phone, true)).toBe(false);
    fireEvent.pointerDown(phone, { pointerType: 'mouse' });
    expect(click(editor, phone)).toBe(false);
    expect(opened).toEqual([]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('after a choice is used, the next click on a link offers the choices again (QA 0.13.0)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { box, editor } = await notes('Call 515-555-0123');
    const phone = smart(box, 'phone');
    // The click that opens the choices also puts the cursor (and the focus) in the notes.
    click(editor, phone);
    act(() => {
      editor.view.focus();
    });
    await screen.findByRole('menu', { name: '515-555-0123' });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(editor.view.hasFocus()).toBe(false);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    fireEvent.pointerDown(phone, { pointerType: 'mouse' });
    click(editor, phone);
    await screen.findByRole('menu', { name: '515-555-0123' });
    act(() => {
      editor.view.focus();
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Text' }));
    expect(opened).toEqual(['sms:5155550123']);
    expect(editor.view.hasFocus()).toBe(false);
  });

  it('a double click selects instead of offering the choices', async () => {
    const { box, editor } = await notes('Call 515-555-0123');
    const view = editor.view;
    const phone = smart(box, 'phone');
    const event = new MouseEvent('mouseup', { button: 0, detail: 2 });
    Object.defineProperty(event, 'target', { value: phone });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    view.someProp('handleClick', (handle) =>
      handle(view, view.posAtDOM(phone.firstChild!, 1), event),
    );
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('the choices leave the focus in the notes, and Escape closes only them', async () => {
    const { box, editor } = await notes('Call 515-555-0123');
    click(editor, smart(box, 'phone'));
    await screen.findByRole('menu', { name: '515-555-0123' });
    act(() => {
      editor.view.focus();
    });
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(editor.isFocused).toBe(true);
  });

  it('opens a link to an email as written, with its subject and nothing decoded', async () => {
    const { box, editor } = await notes(
      '[Email support](mailto:support%40bank.com%3Fbcc%3Dattacker%40evil.com)',
    );
    const link = box.querySelector('a')!;
    expect(click(editor, link, true)).toBe(true);
    expect(opened).toEqual(['mailto:support%40bank.com%3Fbcc%3Dattacker%40evil.com']);
  });

  it('Ctrl + click opens a link straight away, in a new tab', async () => {
    const { box, editor } = await notes('[docs](https://docs.example.com/)');
    const link = box.querySelector('a')!;
    const view = editor.view;
    const event = new MouseEvent('mouseup', { button: 0, ctrlKey: true });
    Object.defineProperty(event, 'target', { value: link });
    view.someProp('handleClick', (handle) => handle(view, view.posAtDOM(link, 0), event));
    expect(opened).toEqual(['https://docs.example.com/']);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// The choices from the keyboard, and a screen reader told about an item (0.14.0, from the PL-146
// review): the notes keep plain text, so the cursor is the way onto an item.
describe('smart links in the notes from the keyboard', () => {
  /** The cursor at `pos` in notes that have the focus. */
  function cursorAt(editor: Editor, pos: number) {
    act(() => {
      editor.view.focus();
      editor.commands.setTextSelection(pos);
    });
  }

  it('Alt+Enter with the cursor in a number offers its choices, focused, and Escape gives the notes the focus back', async () => {
    const { box, editor } = await notes('Call 515-555-0123 now');
    cursorAt(editor, 9);
    fireEvent.keyDown(box, { key: 'Enter', altKey: true });
    await screen.findByRole('menu', { name: '515-555-0123' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Call' })).toHaveFocus());
    // Nothing typed into the notes.
    expect(editor.getText()).toBe('Call 515-555-0123 now');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(editor.isFocused).toBe(true));
  });

  it('a choice taken with Enter opens it and leaves the cursor in the notes', async () => {
    const { box, editor } = await notes('Call 515-555-0123 now');
    cursorAt(editor, 9);
    fireEvent.keyDown(box, { key: 'Enter', altKey: true });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Call' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Text' }), { key: 'Enter' });
    expect(opened).toEqual(['sms:5155550123']);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(editor.isFocused).toBe(true));
  });

  it('Shift+F10 in a link offers its choices; Tab closes them', async () => {
    const { box, editor } = await notes('See [docs](https://docs.example.com/a) first');
    cursorAt(editor, 7);
    fireEvent.keyDown(box, { key: 'F10', shiftKey: true });
    await screen.findByRole('menu', { name: 'https://docs.example.com/a' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it("a link's choices from its start", async () => {
    const { box, editor } = await notes('See [docs](https://docs.example.com/a) first');
    cursorAt(editor, 5);
    fireEvent.keyDown(box, { key: 'Enter', altKey: true });
    await screen.findByRole('menu', { name: 'https://docs.example.com/a' });
  });

  it("a link's choices from its end, with a number one place after it", async () => {
    const { box, editor } = await notes('[docs](https://x.example.com) 515-555-0123');
    cursorAt(editor, 5);
    fireEvent.keyDown(box, { key: 'Enter', altKey: true });
    await screen.findByRole('menu', { name: 'https://x.example.com' });
  });

  it('a click elsewhere closes the choices and leaves the focus where it went', async () => {
    const { box, editor } = await notes('Call 515-555-0123 now');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    cursorAt(editor, 9);
    fireEvent.keyDown(box, { key: 'Enter', altKey: true });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Call' })).toHaveFocus());
    // The button takes the focus on mousedown; the click-away comes after.
    act(() => elsewhere.focus());
    fireEvent.click(elsewhere);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(elsewhere).toHaveFocus();
    expect(editor.isFocused).toBe(false);
  });

  it("opened from the keyboard, the browser's own menu stays shut over the choices", async () => {
    const { box, editor } = await notes('Call 515-555-0123 now');
    cursorAt(editor, 9);
    fireEvent.keyDown(box, { key: 'ContextMenu' });
    const call = await screen.findByRole('menuitem', { name: 'Call' });
    await waitFor(() => expect(call).toHaveFocus());
    // fireEvent says false when the event was prevented.
    expect(fireEvent.contextMenu(call)).toBe(false);
  });

  it('away from an item, the keys do nothing of their own, one place outside it too', async () => {
    const { box, editor } = await notes('Call 515-555-0123 now');
    for (const pos of [2, 5, 19]) {
      cursorAt(editor, pos);
      fireEvent.keyDown(box, { key: 'Enter', altKey: true });
      fireEvent.keyDown(box, { key: 'ContextMenu' });
      expect(screen.queryByRole('menu')).toBeNull();
    }
  });

  it('says what an item is when the cursor comes onto it, and how to open its choices', async () => {
    const { editor } = await notes('Call 515-555-0123 now');
    const said = () => document.querySelector('[role="status"]')?.textContent;
    cursorAt(editor, 2);
    expect(said()).toBe('');
    // One place before it and one after it is not on it.
    cursorAt(editor, 5);
    expect(said()).toBe('');
    cursorAt(editor, 9);
    expect(said()).toBe('Phone number: 515-555-0123. Alt+Enter for choices');
    cursorAt(editor, 19);
    expect(said()).toBe('');
    // Either end of it is.
    cursorAt(editor, 6);
    expect(said()).toBe('Phone number: 515-555-0123. Alt+Enter for choices');
    cursorAt(editor, 20);
    expect(said()).toBe('');
    cursorAt(editor, 18);
    expect(said()).toBe('Phone number: 515-555-0123. Alt+Enter for choices');
  });

  it('in notes that cannot be edited, each item is a button: Enter offers its choices and Escape comes back to it', async () => {
    renderThemed(
      <TiptapEditor label="Notes" value="Call 515-555-0123 now" readOnly onCommit={vi.fn()} />,
    );
    const button = await screen.findByRole('button', { name: 'Phone number: 515-555-0123' });
    expect(button).toHaveAttribute('tabindex', '0');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    act(() => button.focus());
    fireEvent.keyDown(button, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Call' })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(button).toHaveFocus();
  });

  it('in notes that cannot be edited, Space offers the choices on its keyup and presses none of them', async () => {
    renderThemed(
      <TiptapEditor label="Notes" value="Call 515-555-0123 now" readOnly onCommit={vi.fn()} />,
    );
    const button = await screen.findByRole('button', { name: 'Phone number: 515-555-0123' });
    act(() => button.focus());
    // Down: nothing yet, and no page scroll.
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    // Up: the choices, the first focused, none taken.
    fireEvent.keyUp(button, { key: ' ' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Call' })).toHaveFocus());
    expect(opened).toEqual([]);
  });

  it('in notes that cannot be edited, an item with bold in it is still one button', async () => {
    renderThemed(
      <TiptapEditor label="Notes" value="Call 515-**555**-0123 now" readOnly onCommit={vi.fn()} />,
    );
    const buttons = await screen.findAllByRole('button', { name: 'Phone number: 515-555-0123' });
    expect(buttons).toHaveLength(1);
    expect(document.querySelectorAll('[data-smart="phone"][tabindex]')).toHaveLength(1);
  });

  it('in notes being edited, items are no tab stops', async () => {
    const { box } = await notes('Call 515-555-0123 now');
    expect(smart(box, 'phone')).not.toHaveAttribute('tabindex');
    expect(smart(box, 'phone')).not.toHaveAttribute('role');
  });
});

describe('opening a smart link', () => {
  it('never opens an address notes may not open', () => {
    expect(openOutside('javascript:alert(1)')).toBe(false);
    expect(openOutside('intent://x#Intent;end')).toBe(false);
    expect(opened).toEqual([]);
    expect(openOutside('tel:+15155550123')).toBe(true);
    expect(opened).toEqual(['tel:+15155550123']);
  });

  it('opens web pages in a new tab without the opener', () => {
    const links: { target: string; rel: string }[] = [];
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      links.push({ target: this.target, rel: this.rel });
    });
    openOutside('https://example.com/');
    openOutside('mailto:sam@example.com');
    expect(links).toEqual([
      { target: '_blank', rel: 'noopener noreferrer' },
      { target: '', rel: '' },
    ]);
  });
});
