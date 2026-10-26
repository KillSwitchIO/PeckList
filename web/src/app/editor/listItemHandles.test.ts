import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { moveListItem } from './listItemHandles.ts';
import { editorMarkdown, notesExtensions } from './tiptapMarkdown.ts';

/** The notes after moving the `from`th item of the first list to `to` (counted without it). */
function moved(markdown: string, from: number, to: number): string {
  const editor = new Editor({
    extensions: notesExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  try {
    const items: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') items.push(pos);
      // Only the first list's own items.
      return items.length === 0 || node.type.name.endsWith('List');
    });
    const tr = moveListItem(editor.state, items[from]!, to);
    if (tr) editor.view.dispatch(tr);
    return editorMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

describe('moving a list item in the notes (R-FB-80)', () => {
  it('renumbers a numbered list', () => {
    expect(moved('1. Milk\n2. Eggs\n3. Bread', 0, 2)).toBe('1. Eggs\n2. Bread\n3. Milk');
    expect(moved('1. Milk\n2. Eggs\n3. Bread', 2, 0)).toBe('1. Bread\n2. Milk\n3. Eggs');
  });

  it('keeps a checklist item ticked as it moves', () => {
    expect(moved('- [ ] Milk\n- [x] Eggs\n- [ ] Bread', 1, 2)).toBe(
      '- [ ] Milk\n- [ ] Bread\n- [x] Eggs',
    );
  });

  it('moves a bullet with what is nested under it', () => {
    expect(moved('- Fruit\n  - Apples\n- Veg', 0, 1)).toBe('- Veg\n- Fruit\n  - Apples');
  });

  it('leaves it alone when it is let go where it was', () => {
    expect(moved('- A\n- B', 0, 0)).toBe('- A\n- B');
  });
});
