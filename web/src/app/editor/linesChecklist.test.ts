import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { isAllChecklist } from './linesChecklist.ts';
import { editorMarkdown, notesExtensions } from './tiptapMarkdown.ts';

/** The notes after one command, as markdown. */
function run(markdown: string, command: 'linesToChecklist' | 'checklistToLines'): string {
  const editor = new Editor({
    extensions: notesExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  try {
    editor.commands[command]();
    return editorMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

describe('notes to a checklist and back, one box per line', () => {
  it.each([
    [
      'lines in one paragraph',
      'call the vet\nask about the shots',
      '- [ ] call the vet\n- [ ] ask about the shots',
    ],
    ['paragraphs', 'first\n\nsecond', '- [ ] first\n- [ ] second'],
    [
      'bullets, nested ones flattened',
      '- posts\n- concrete\n  - two bags',
      '- [ ] posts\n- [ ] concrete\n- [ ] two bags',
    ],
    ['numbers', '1. dig\n2. set', '- [ ] dig\n- [ ] set'],
    ['a checklist keeps its ticks', '- [x] bought\n- [ ] not yet', '- [x] bought\n- [ ] not yet'],
    [
      'formatting travels with the line',
      '**bold** start\nplain',
      '- [ ] **bold** start\n- [ ] plain',
    ],
    [
      'headings and code stay as they are',
      '# Plan\n\ndig\nset\n\n```\nnpm run dev\n```',
      '# Plan\n\n- [ ] dig\n- [ ] set\n\n```\nnpm run dev\n```',
    ],
    ['blank lines are not boxes', 'one\n\n\n\ntwo', '- [ ] one\n- [ ] two'],
  ])('every line a checkbox: %s', (_name, notes, expected) => {
    expect(run(notes, 'linesToChecklist')).toBe(expected);
  });

  it.each([
    ['boxes to lines, ticks dropped', '- [x] bought\n- [ ] not yet', 'bought\n\nnot yet'],
    ['nested boxes flattened', '- [ ] posts\n  - [ ] two bags', 'posts\n\ntwo bags'],
    ['other blocks stay', '# Plan\n\n- [ ] dig\n- [ ] set', '# Plan\n\ndig\n\nset'],
    ['plain notes are left alone', 'just a note', 'just a note'],
  ])('checkboxes back to lines: %s', (_name, notes, expected) => {
    expect(run(notes, 'checklistToLines')).toBe(expected);
  });

  it.each([
    ['a checklist', '- [ ] dig\n- [x] set', true],
    // Ben, 2026-11-02: a title in the middle converted one way but not back.
    ['a checklist with a title in the middle', '- [ ] dig\n\n## Then\n\n- [ ] set', true],
    ['a checklist with code and a divider', '- [ ] dig\n\n---\n\n```\nnpm run dev\n```', true],
    ['a checklist and a plain line', '- [ ] dig\n\nset the posts', false],
    ['no checklist at all', '# Plan\n\ndig', false],
  ])('the toolbar offers back to lines for %s', (_name, notes, expected) => {
    const editor = new Editor({
      extensions: notesExtensions(),
      content: notes,
      contentType: 'markdown',
    });
    try {
      expect(isAllChecklist(editor.state.doc)).toBe(expected);
    } finally {
      editor.destroy();
    }
  });

  it('a checklist with a title in the middle goes back to lines', () => {
    expect(run('- [ ] dig\n\n## Then\n\n- [x] set', 'checklistToLines')).toBe(
      'dig\n\n## Then\n\nset',
    );
  });

  it('empty notes stay empty either way', () => {
    expect(run('', 'linesToChecklist')).toBe('');
    expect(run('', 'checklistToLines')).toBe('');
  });
});
