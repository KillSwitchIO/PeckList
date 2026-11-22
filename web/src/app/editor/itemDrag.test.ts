import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spotAt } from './itemDrag.ts';
import { notesExtensions } from './tiptapMarkdown.ts';

/** Notes with every line 24 px tall, one under another from the top (jsdom draws nothing). */
function drawn(markdown: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: notesExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  const lines = [...editor.view.dom.querySelectorAll('h1, h2, h3, p')];
  const boxes = new Map<Element, DOMRect>();
  lines.forEach((line, index) => boxes.set(line, new DOMRect(40, index * 24, 300, 24)));
  // An item's element starts left of its line, where its marker or checkbox is.
  for (const li of editor.view.dom.querySelectorAll('li')) {
    const line = boxes.get(li.querySelector('p')!)!;
    boxes.set(li, new DOMRect(16, line.top, 324, line.height));
  }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxes.get(this) ?? new DOMRect(0, 0, 0, 0);
  });
  const item = (text: string) => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.type.name === 'taskItem' && node.firstChild?.textContent === text)
        found = pos;
      return found < 0;
    });
    return found;
  };
  return { editor, item, done: () => (editor.destroy(), element.remove()) };
}

afterEach(() => vi.restoreAllMocks());

describe('where a dragged notes item would land (PL-149)', () => {
  it('reads the place from where the pointer is on a line', () => {
    // Lines: A 0-24, One 24-48, B 48-72, Two 72-96, Three (under Two) 96-120.
    const { editor, item, done } = drawn('## A\n\n- [ ] One\n\n## B\n\n- [ ] Two\n  - [ ] Three');
    try {
      const one = item('One');
      const spot = (y: number) => spotAt(editor.view, one, y);
      // The lower half of a heading: the gap after it, so across that heading.
      expect(spot(64)).toMatchObject({ drop: { kind: 'gap', index: 3 }, top: 72, nest: false });
      expect(spot(52)).toMatchObject({ drop: { kind: 'gap', index: 2 }, top: 48 });
      // On an item's line: the top quarter before it, the middle onto it (nested, indented, the
      // row tinted), and the bottom quarter first among what is nested under it.
      expect(spot(74)).toMatchObject({
        drop: { kind: 'before', item: item('Two') },
        top: 72,
        left: 16,
      });
      expect(spot(84)).toMatchObject({
        drop: { kind: 'nest', item: item('Two') },
        top: 96,
        left: 40,
        nest: true,
      });
      expect(spot(84)?.row?.top).toBe(72);
      expect(spot(94)).toMatchObject({
        drop: { kind: 'before', item: item('Three') },
        left: 40,
        nest: false,
      });
      // The bottom quarter of an item with nothing under it: after it.
      expect(spot(118)).toMatchObject({ drop: { kind: 'after', item: item('Three') }, top: 120 });
      // Past the end: after the nearest line.
      expect(spot(400)).toMatchObject({ drop: { kind: 'after', item: item('Three') } });
      // Over the item being dragged: nowhere.
      expect(spot(36)).toBeNull();
    } finally {
      done();
    }
  });

  it('never lands inside what is nested under the dragged item', () => {
    const { editor, item, done } = drawn('- [ ] Two\n  - [ ] Three\n- [ ] Four');
    try {
      expect(spotAt(editor.view, item('Two'), 36)).toBeNull();
      // Its own line's bottom quarter would be first under itself: nowhere too.
      expect(spotAt(editor.view, item('Two'), 22)).toBeNull();
      expect(spotAt(editor.view, item('Two'), 60)).toMatchObject({
        drop: { kind: 'nest', item: item('Four') },
      });
    } finally {
      done();
    }
  });
});
