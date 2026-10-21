// The TipTap schema for notes and its markdown bridge. Notes are stored as plain markdown, so
// the serializer here escapes only what would otherwise turn into formatting: a note typed as
// plain text ("2 < 3 & snake_case") comes back exactly as it went in.

import { Editor, type AnyExtension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Backslash-escape the characters of a text run that markdown would read as syntax, and nothing
 * else. Run edges count as "not a space", so a marker next to formatting is still escaped.
 */
export function escapeMarkdownText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const prev = text[i - 1];
    const next = text[i + 1];
    const rest = text.slice(i + 1);
    let escape = false;
    switch (c) {
      case '\\':
        // A backslash is literal unless it comes before punctuation ("C:\notes" stays as is).
        escape = next === undefined || PUNCTUATION.test(next);
        break;
      case '`':
        escape = true;
        break;
      case '*':
      case '~':
        // A lone marker between spaces ("2 * 3") can't open emphasis.
        escape = !(isSpace(prev) && isSpace(next));
        break;
      case '_':
        // Neither can one inside a word (snake_case) or between spaces.
        escape = !((isWord(prev) && isWord(next)) || (isSpace(prev) && isSpace(next)));
        break;
      case '[':
        // Only the start of something that reads as a link or reference.
        escape = /^[^\]]*\][([:]/.test(rest);
        break;
      case '<':
        // Only the start of a tag, comment or autolink ("2 < 3" stays).
        escape = /^[a-zA-Z/!?]/.test(rest);
        break;
      case '&':
        // Only something that reads as an entity ("&amp;"); "salt & pepper" stays.
        escape = /^(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(rest);
        break;
    }
    out += escape ? `\\${c}` : c;
  }
  return out;
}

const CODE_TYPES = new Set(['code', 'codeBlock']);

interface TextNode {
  marks?: (string | { type: string })[];
}

/** Swap TipTap's text encoding (HTML entities plus blanket escapes) for ours. */
function applyMinimalEscaping(manager: MarkdownManager) {
  const target = manager as unknown as {
    encodeTextForMarkdown: (text: string, node: TextNode, parent?: { type?: string }) => string;
  };
  target.encodeTextForMarkdown = (text, node, parent) => {
    const inCode =
      (parent?.type !== undefined && CODE_TYPES.has(parent.type)) ||
      (node.marks ?? []).some((mark) =>
        CODE_TYPES.has(typeof mark === 'string' ? mark : mark.type),
      );
    return inCode ? text : escapeMarkdownText(text);
  };
}

const NotesMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    applyMinimalEscaping(this.storage.manager);
  },
});

/** The notes schema: everyday formatting, links and checklists, read and written as markdown. */
export function notesExtensions(placeholder?: string): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      // Underline has no markdown form; keep notes to what markdown can store.
      underline: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    NotesMarkdown,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

/**
 * The editor's text as markdown. The editor keeps an empty line after a closing list so the
 * cursor can leave it; that line isn't part of the note.
 */
export function editorMarkdown(editor: Editor): string {
  return editor.getMarkdown().replace(/\n+$/, '');
}

/** Parse markdown and write it back out, as the editor would (for tests and checks). */
export function roundTripMarkdown(markdown: string): string {
  const editor = new Editor({
    extensions: notesExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  try {
    return editorMarkdown(editor);
  } finally {
    editor.destroy();
  }
}
