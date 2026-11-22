import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { editorMarkdown, notesExtensions } from './tiptapMarkdown.ts';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function open(markdown: string) {
  editor?.destroy();
  editor = new Editor({
    extensions: notesExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  return editor;
}

/** A key as the editor hears it; false when the editor leaves it to the browser. */
function press(key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor!.view.someProp('handleKeyDown', (handle) => handle(editor!.view, event)) ?? false;
}

/** Take the letters of the line reading `text` away, as Backspace does one by one, cursor left there. */
function clear(text: string) {
  let end = -1;
  editor!.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isTextblock && node.textContent === text) end = pos + 1 + node.content.size;
    return end < 0;
  });
  editor!.view.dispatch(editor!.state.tr.delete(end - text.length, end));
  editor!.commands.setTextSelection(end - text.length);
}

const type = (text: string) => editor!.commands.insertContent(text);
const markdown = () => editorMarkdown(editor!);
/** The top-level blocks, by kind ('p' for a paragraph, '' for an empty one). */
const blocks = () =>
  editor!.state.doc.content.content.map((block) =>
    block.type.name === 'paragraph' ? (block.content.size ? 'p' : '') : block.type.name,
  );

describe('Backspace in an empty list item (PL-149)', () => {
  it('deletes the item, cursor to the end of the line before', () => {
    open('Top\n\n- [ ] One\n- [ ] Two\n- [ ] Three');
    clear('Two');
    expect(press('Backspace')).toBe(true);
    expect(markdown()).toBe('Top\n\n- [ ] One\n- [ ] Three');
    type('!');
    expect(markdown()).toBe('Top\n\n- [ ] One!\n- [ ] Three');
  });

  it('leaves no blank line behind, so typing on is spaced as fresh text is (Ben)', () => {
    open('Top\n\n- [ ] One\n- [ ] Two');
    clear('Two');
    press('Backspace');
    clear('One');
    press('Backspace');
    // Back on "Top", with nothing between it and the line the editor keeps at the end.
    expect(markdown()).toBe('Top');
    expect(blocks()).toEqual(['p', '']);
    press('Enter');
    type('Next');
    const after = editor!.getJSON();
    expect(markdown()).toBe('Top\n\nNext');

    // The same lines typed into empty notes.
    open('');
    type('Top');
    press('Enter');
    type('Next');
    expect(markdown()).toBe('Top\n\nNext');
    expect(editor!.getJSON().content?.slice(0, 2)).toEqual(after.content?.slice(0, 2));
  });

  it('never leaves &nbsp; in what is saved', () => {
    open('Top\n\n- [ ] One\n- [ ] Two\n\nBottom');
    clear('Two');
    press('Backspace');
    clear('One');
    press('Backspace');
    expect(markdown()).toBe('Top\n\nBottom');
    expect(markdown()).not.toContain('&nbsp;');
  });

  it('at the top of the notes, goes to the start of the next item', () => {
    open('- [ ] One\n- [ ] Two');
    clear('One');
    press('Backspace');
    type('>');
    expect(markdown()).toBe('- [ ] >Two');
  });

  it('takes a nested list with its last item, back to the item it was under', () => {
    open('- Fruit\n  - Apples\n- Veg');
    clear('Apples');
    press('Backspace');
    type('!');
    expect(markdown()).toBe('- Fruit!\n- Veg');
  });

  it('leaves the editor its own Backspace for an item with something under it, and for the only line', () => {
    open('- Fruit\n  - Apples');
    clear('Fruit');
    press('Backspace');
    expect(markdown()).toContain('Apples');
    open('- [ ] One');
    clear('One');
    press('Backspace');
    expect(blocks()[0]).toBe('');
  });
});
