// Notes to a checklist and back, one box per line: "/" + "Every line a checkbox" turns what is
// in the notes into a checklist (each paragraph, each line after a line break, each bullet or
// numbered item becomes its own box, ticked boxes stay ticked), and "Checkboxes back to lines"
// turns a checklist into plain lines again. Headings, code and dividers keep their place;
// only the lines between them change shape.

import { Extension } from '@tiptap/core';
import type { Node, Schema } from '@tiptap/pm/model';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linesChecklist: {
      /** Every line of the notes as its own checkbox. */
      linesToChecklist: () => ReturnType;
      /** Every checkbox as a plain line. */
      checklistToLines: () => ReturnType;
    };
  }
}

/** The inline content of one line: a text run between line breaks, marks kept. */
type Line = Node[];

/** Blocks whose lines turn into boxes (or back); anything else keeps its place as it is. */
const LINE_BLOCKS = new Set(['paragraph', 'bulletList', 'orderedList', 'taskList', 'blockquote']);

/**
 * The lines of a paragraph-like block, split at its hard breaks and at the newlines markdown
 * keeps inside a text run (a soft break); empty lines dropped.
 */
function linesOf(block: Node): Line[] {
  const lines: Line[] = [];
  let current: Line = [];
  const breakLine = () => {
    lines.push(current);
    current = [];
  };
  block.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      breakLine();
    } else if (child.isText && child.text?.includes('\n')) {
      child.text.split('\n').forEach((part, index) => {
        if (index > 0) breakLine();
        if (part) current.push(child.type.schema.text(part, child.marks));
      });
    } else {
      current.push(child);
    }
  });
  lines.push(current);
  return lines.filter((line) => line.some((node) => node.textContent.trim() !== ''));
}

/**
 * The lines inside a block, in reading order, each with whether it was a ticked box. A list
 * item has its own paragraph first, then the lines of its nested lists.
 */
function collectLines(block: Node, checked = false): { line: Line; checked: boolean }[] {
  const type = block.type.name;
  if (type === 'paragraph') return linesOf(block).map((line) => ({ line, checked }));
  const out: { line: Line; checked: boolean }[] = [];
  if (type === 'taskItem' || type === 'listItem') {
    const own = type === 'taskItem' ? Boolean(block.attrs.checked) : false;
    block.forEach((child) => out.push(...collectLines(child, own)));
  } else if (LINE_BLOCKS.has(type)) {
    block.forEach((child) => out.push(...collectLines(child, checked)));
  }
  return out;
}

/** The notes with every line as a checkbox: runs of line blocks become one checklist each. */
export function toChecklist(doc: Node, schema: Schema): Node[] {
  const { paragraph, taskItem, taskList } = schema.nodes;
  if (!paragraph || !taskItem || !taskList) return [doc];
  const out: Node[] = [];
  let items: Node[] = [];
  const flush = () => {
    if (items.length) out.push(taskList.create(null, items));
    items = [];
  };
  doc.forEach((block) => {
    if (!LINE_BLOCKS.has(block.type.name)) {
      flush();
      out.push(block);
      return;
    }
    for (const { line, checked } of collectLines(block)) {
      items.push(taskItem.create({ checked }, paragraph.create(null, line)));
    }
  });
  flush();
  return out;
}

/** The notes with every checkbox as a plain line; other blocks as they were. */
export function toLines(doc: Node, schema: Schema): Node[] {
  const { paragraph } = schema.nodes;
  if (!paragraph) return [doc];
  const out: Node[] = [];
  doc.forEach((block) => {
    if (block.type.name !== 'taskList') {
      out.push(block);
      return;
    }
    for (const { line } of collectLines(block)) out.push(paragraph.create(null, line));
  });
  return out;
}

/**
 * True when every line in the notes is a checkbox, so "back to lines" is the move. Headings, code
 * and dividers keep their place either way, so they do not count: a checklist with a title in the
 * middle still goes back to lines.
 */
export function isAllChecklist(doc: Node): boolean {
  let lists = 0;
  let lines = 0;
  doc.forEach((block) => {
    if (block.type.name === 'taskList') lists++;
    else if (LINE_BLOCKS.has(block.type.name) && collectLines(block).length > 0) lines++;
  });
  return lists > 0 && lines === 0;
}

export const LinesChecklist = Extension.create({
  name: 'linesChecklist',
  addCommands() {
    return {
      linesToChecklist:
        () =>
        ({ state, tr, dispatch }) => {
          const blocks = toChecklist(state.doc, state.schema);
          if (!blocks.length) return false;
          if (dispatch) tr.replaceWith(0, state.doc.content.size, blocks);
          return true;
        },
      checklistToLines:
        () =>
        ({ state, tr, dispatch }) => {
          const blocks = toLines(state.doc, state.schema);
          if (!blocks.length) return false;
          if (dispatch) tr.replaceWith(0, state.doc.content.size, blocks);
          return true;
        },
    };
  },
});
