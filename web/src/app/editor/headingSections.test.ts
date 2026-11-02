import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { moveSection, sectionsOf, sectionTargets } from './headingSections.ts';
import { editorMarkdown, notesExtensions } from './tiptapMarkdown.ts';

// Ben, 2026-11-02: "H1 and h4 could be swapped bringing h2,h3 with h1. H2 and h3 could be
// swapped in h1 or dragged into h4."
const NOTES = [
  '# One',
  'under one',
  '## Two',
  'under two',
  '## Three',
  'under three',
  '# Four',
  'under four',
].join('\n\n');

/** The notes after moving the section headed `heading` to before `before` (null: the end). */
function move(heading: string, before: string | null, notes = NOTES): string | null {
  const editor = new Editor({
    extensions: notesExtensions(),
    content: notes,
    contentType: 'markdown',
  });
  try {
    const at = (title: string) => {
      let found = -1;
      editor.state.doc.forEach((block, offset) => {
        if (block.type.name === 'heading' && block.textContent === title) found = offset;
      });
      return found;
    };
    const target = before === null ? editor.state.doc.content.size : at(before);
    const tr = moveSection(editor.state, at(heading), target);
    if (!tr) return null;
    editor.view.dispatch(tr);
    return editorMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

const lines = (markdown: string | null) => markdown?.split('\n').filter(Boolean);

describe('moving a heading with everything under it', () => {
  it('swaps two top-level sections, the subsections coming along', () => {
    expect(lines(move('Four', 'One'))).toEqual([
      '# Four',
      'under four',
      '# One',
      'under one',
      '## Two',
      'under two',
      '## Three',
      'under three',
    ]);
    expect(lines(move('One', null))).toEqual(lines(move('Four', 'One')));
  });

  it('swaps two subsections within their section', () => {
    expect(lines(move('Three', 'Two'))).toEqual([
      '# One',
      'under one',
      '## Three',
      'under three',
      '## Two',
      'under two',
      '# Four',
      'under four',
    ]);
  });

  it('moves a subsection into another section', () => {
    expect(lines(move('Two', null))).toEqual([
      '# One',
      'under one',
      '## Three',
      'under three',
      '# Four',
      'under four',
      '## Two',
      'under two',
    ]);
  });

  it('goes only before a heading of its level or higher, or to the end', () => {
    const editor = new Editor({
      extensions: notesExtensions(),
      content: NOTES,
      contentType: 'markdown',
    });
    try {
      const sections = sectionsOf(editor.state.doc);
      const [one, two, three, four] = sections;
      expect(sections.map((section) => section.level)).toEqual([1, 2, 2, 1]);
      expect(one!.end).toBe(four!.pos);
      // A top-level section cannot land between a section's heading and its subsections.
      expect(sectionTargets(editor.state.doc, one!.pos)).toEqual([
        four!.pos,
        editor.state.doc.content.size,
      ]);
      expect(sectionTargets(editor.state.doc, two!.pos)).toEqual([
        one!.pos,
        three!.pos,
        four!.pos,
        editor.state.doc.content.size,
      ]);
    } finally {
      editor.destroy();
    }
    // A top-level section in among another's subsections, or into itself: refused.
    expect(move('Four', 'Two')).toBeNull();
    expect(move('One', 'Two')).toBeNull();
    // Where it already is: nothing to do.
    expect(move('Two', 'Three')).toBeNull();
  });
});
