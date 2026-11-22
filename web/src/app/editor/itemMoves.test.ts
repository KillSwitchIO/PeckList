import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { moveItemTo, type ItemDrop } from './itemMoves.ts';
import { editorMarkdown, notesExtensions } from './tiptapMarkdown.ts';

type Drop = { kind: 'before' | 'after' | 'nest'; item: string } | { kind: 'gap'; index: number };

/** The notes after moving the item whose own line reads `text` to `drop` (items named by text). */
function moved(markdown: string, text: string, drop: Drop): string {
  const editor = new Editor({
    extensions: notesExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  try {
    const at = (line: string) => {
      let found: number | undefined;
      editor.state.doc.descendants((node, pos) => {
        if (
          found === undefined &&
          /^(listItem|taskItem)$/.test(node.type.name) &&
          node.firstChild?.textContent === line
        )
          found = pos;
        return found === undefined;
      });
      if (found === undefined) throw new Error(`no item ${line}`);
      return found;
    };
    const target: ItemDrop = drop.kind === 'gap' ? drop : { kind: drop.kind, item: at(drop.item) };
    const tr = moveItemTo(editor.state, at(text), target);
    if (tr) {
      tr.doc.check();
      editor.view.dispatch(tr);
    }
    return editorMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

describe('moving a list item in the notes (R-FB-80, PL-149)', () => {
  it('moves within its list, renumbering a numbered one', () => {
    expect(moved('1. Milk\n2. Eggs\n3. Bread', 'Milk', { kind: 'after', item: 'Bread' })).toBe(
      '1. Eggs\n2. Bread\n3. Milk',
    );
    expect(moved('1. Milk\n2. Eggs\n3. Bread', 'Bread', { kind: 'before', item: 'Milk' })).toBe(
      '1. Bread\n2. Milk\n3. Eggs',
    );
  });

  it('keeps a checklist item ticked, and takes what is nested under it along', () => {
    expect(
      moved('- [ ] Milk\n- [x] Eggs\n- [ ] Bread', 'Eggs', { kind: 'after', item: 'Bread' }),
    ).toBe('- [ ] Milk\n- [ ] Bread\n- [x] Eggs');
    expect(moved('- Fruit\n  - Apples\n- Veg', 'Fruit', { kind: 'after', item: 'Veg' })).toBe(
      '- Veg\n- Fruit\n  - Apples',
    );
  });

  it('changes nothing where it was let go, or inside itself', () => {
    expect(moved('- A\n- B', 'A', { kind: 'before', item: 'B' })).toBe('- A\n- B');
    expect(moved('- A\n- B', 'B', { kind: 'after', item: 'A' })).toBe('- A\n- B');
    expect(moved('- A\n  - B\n- C', 'A', { kind: 'nest', item: 'B' })).toBe('- A\n  - B\n- C');
  });

  it('goes across a heading into the list under it (Ben: it could not)', () => {
    const notes = '## Shop\n\n- [ ] Milk\n- [ ] Eggs\n\n## Garden\n\n- [ ] Mow\n- [ ] Weed';
    expect(moved(notes, 'Eggs', { kind: 'before', item: 'Weed' })).toBe(
      '## Shop\n\n- [ ] Milk\n\n## Garden\n\n- [ ] Mow\n- [ ] Eggs\n- [ ] Weed',
    );
    // The last item out of a list takes the list with it.
    expect(
      moved('## Shop\n\n- [ ] Milk\n\n## Garden\n\n- [ ] Mow', 'Milk', {
        kind: 'after',
        item: 'Mow',
      }),
    ).toBe('## Shop\n\n## Garden\n\n- [ ] Mow\n- [ ] Milk');
  });

  it('starts a list of its own kind in a gap between blocks, or joins one there', () => {
    // Under a heading with only text: a list of its own (a numbered item stays numbered).
    expect(
      moved('## Shop\n\nSome text\n\n## Garden\n\n1. Mow\n2. Weed', 'Weed', {
        kind: 'gap',
        index: 2,
      }),
    ).toBe('## Shop\n\nSome text\n\n1. Weed\n\n## Garden\n\n1. Mow');
    // Right under a heading whose list is of its kind: first in that list.
    expect(
      moved('## Shop\n\n- [ ] Milk\n\n## Garden\n\n- [ ] Mow', 'Mow', { kind: 'gap', index: 1 }),
    ).toBe('## Shop\n\n- [ ] Mow\n- [ ] Milk\n\n## Garden');
    // At the very end, after a list of its kind: last in it.
    expect(
      moved('- [ ] Milk\n- [ ] Eggs\n\n## Garden\n\n- [ ] Mow', 'Milk', { kind: 'gap', index: 3 }),
    ).toBe('- [ ] Eggs\n\n## Garden\n\n- [ ] Mow\n- [ ] Milk');
  });

  it('keeps to its own kind of list in a gap or nested: a bullet never joins numbers', () => {
    expect(moved('1. One\n2. Two\n\n## H\n\n- Bul', 'Bul', { kind: 'gap', index: 1 })).toBe(
      '1. One\n2. Two\n\n- Bul\n\n## H',
    );
    expect(moved('- A\n- B\n\n## H\n\n1. Num', 'Num', { kind: 'gap', index: 1 })).toBe(
      '- A\n- B\n\n1. Num\n\n## H',
    );
    expect(moved('- Fruit\n  1. Apples\n- Pears', 'Pears', { kind: 'nest', item: 'Fruit' })).toBe(
      '- Fruit\n  - Pears\n  1. Apples',
    );
  });

  it('takes the kind of the list it joins beside an item', () => {
    expect(
      moved('- [x] Milk\n\n## Notes\n\n- Idea', 'Milk', { kind: 'before', item: 'Idea' }),
    ).toBe('## Notes\n\n- Milk\n- Idea');
    expect(moved('- Milk\n\n## Shop\n\n- [x] Eggs', 'Milk', { kind: 'after', item: 'Eggs' })).toBe(
      '## Shop\n\n- [x] Eggs\n- [ ] Milk',
    );
  });

  it('indents an item dropped on another under it (Ben), first under it', () => {
    expect(
      moved('- [ ] Paint\n- [ ] Buy paint\n- [ ] Brushes', 'Buy paint', {
        kind: 'nest',
        item: 'Paint',
      }),
    ).toBe('- [ ] Paint\n  - [ ] Buy paint\n- [ ] Brushes');
    expect(moved('- Fruit\n  - Apples\n- Pears', 'Pears', { kind: 'nest', item: 'Fruit' })).toBe(
      '- Fruit\n  - Pears\n  - Apples',
    );
    // From under one heading onto an item under another.
    expect(
      moved('## A\n\n- [ ] One\n\n## B\n\n- [ ] Two', 'One', { kind: 'nest', item: 'Two' }),
    ).toBe('## A\n\n## B\n\n- [ ] Two\n  - [ ] One');
  });

  it('joins the two lists an emptied list leaves side by side', () => {
    expect(moved('- A\n\n1. One\n\n- B\n\n## End', 'One', { kind: 'gap', index: 4 })).toBe(
      '- A\n- B\n\n## End\n\n1. One',
    );
  });
});
