// Slash commands: type "/" in notes for a menu of blocks (headings, lists, checklist, quote,
// code, divider), so formatting doesn't need markdown. The menu itself is drawn by the editor
// component; this file holds the commands and the TipTap hook that drives it.

import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';

export type SlashCommandId =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'checklist'
  | 'linesToChecklist'
  | 'checklistToLines'
  | 'quote'
  | 'codeBlock'
  | 'divider';

export interface SlashCommand {
  id: SlashCommandId;
  /** Extra words that find it ("todo" finds Checklist). */
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
}

const start = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'heading1',
    keywords: ['h1', 'title', 'big'],
    run: (editor, range) => start(editor, range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'heading2',
    keywords: ['h2', 'subtitle'],
    run: (editor, range) => start(editor, range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'heading3',
    keywords: ['h3', 'small'],
    run: (editor, range) => start(editor, range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bulletList',
    keywords: ['ul', 'unordered', 'points'],
    run: (editor, range) => start(editor, range).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    keywords: ['ol', 'numbers', 'steps'],
    run: (editor, range) => start(editor, range).toggleOrderedList().run(),
  },
  {
    id: 'checklist',
    keywords: ['todo', 'task', 'checkbox'],
    run: (editor, range) => start(editor, range).toggleTaskList().run(),
  },
  {
    id: 'linesToChecklist',
    keywords: ['convert', 'every', 'all', 'lines', 'boxes'],
    run: (editor, range) => start(editor, range).linesToChecklist().run(),
  },
  {
    id: 'checklistToLines',
    keywords: ['convert', 'plain', 'text', 'unlist', 'back'],
    run: (editor, range) => start(editor, range).checklistToLines().run(),
  },
  {
    id: 'quote',
    keywords: ['blockquote', 'cite'],
    run: (editor, range) => start(editor, range).toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    keywords: ['code', 'pre', 'snippet'],
    run: (editor, range) => start(editor, range).toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    keywords: ['hr', 'line', 'rule', 'separator'],
    run: (editor, range) => start(editor, range).setHorizontalRule().run(),
  },
];

/** Commands whose name (as shown) or keywords start with the typed words. */
export function matchSlashCommands(
  query: string,
  nameOf: (id: SlashCommandId) => string,
): SlashCommand[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) =>
    [nameOf(command.id), ...command.keywords].some((word) =>
      word
        .toLowerCase()
        .split(/\s+/)
        .some((part) => part.startsWith(wanted)),
    ),
  );
}

/** What the editor component does as the "/" menu opens, changes, takes keys and closes. */
export interface SlashMenuHandlers {
  open: (props: SuggestionProps<SlashCommand>) => void;
  update: (props: SuggestionProps<SlashCommand>) => void;
  keyDown: (props: SuggestionKeyDownProps) => boolean;
  close: () => void;
}

/** Where the "/" hook finds the component's current handlers (set after each render). */
export interface SlashMenuBridge {
  readonly handlers: SlashMenuHandlers | null;
  set: (handlers: SlashMenuHandlers) => void;
}

export function createSlashMenuBridge(): SlashMenuBridge {
  let current: SlashMenuHandlers | null = null;
  return {
    get handlers() {
      return current;
    },
    set: (handlers) => {
      current = handlers;
    },
  };
}

/**
 * The "/" trigger. The bridge is read on every event, so the component can swap its handlers as
 * it re-renders; `nameOf` gives the shown names used for matching.
 */
export function slashCommandsExtension(
  bridge: SlashMenuBridge,
  nameOf: (id: SlashCommandId) => string,
) {
  return Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand, SlashCommand>({
          editor: this.editor,
          pluginKey: new PluginKey('slashCommands'),
          char: '/',
          // A "/" in the middle of a word (and/or, 1/2) isn't a command.
          allowedPrefixes: [' '],
          items: ({ query }) => matchSlashCommands(query, nameOf),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (props) => bridge.handlers?.open(props),
            onUpdate: (props) => bridge.handlers?.update(props),
            onKeyDown: (props) => bridge.handlers?.keyDown(props) ?? false,
            onExit: () => bridge.handlers?.close(),
          }),
        }),
      ];
    },
  });
}
