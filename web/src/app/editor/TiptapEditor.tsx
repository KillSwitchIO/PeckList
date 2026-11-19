// The RichTextEditor adapter for TipTap: formats as you type (`**bold**`, `- list`, `# heading`,
// `[ ] ` checklist) and hands back plain markdown; "/" opens a menu of blocks for anyone who
// doesn't know markdown. Inline it is always editable and never changes size (no edit mode, PL-016);
// checklist boxes tick without taking focus. Expanded (the full editor) it shows a toolbar.

import {
  Box,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  Tooltip,
  useTheme,
} from '@mui/material';
import { getMarkRange, type Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { SuggestionProps } from '@tiptap/suggestion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { RichTextEditorProps } from '../../ports/richText.ts';
import { t } from '../i18n/i18n.ts';
import {
  AllLinesChecklistIcon,
  BoldIcon,
  BulletListIcon,
  ChecklistIcon,
  CodeIcon,
  DividerIcon,
  HeadingIcon,
  ItalicIcon,
  LinkIcon,
  NotesLinesIcon,
  NumberedListIcon,
  QuoteIcon,
  StrikeIcon,
} from '../icons/icons.tsx';
import {
  createSlashMenuBridge,
  slashCommandsExtension,
  type SlashCommand,
  type SlashCommandId,
  type SlashMenuHandlers,
} from './slashCommands.ts';
import { hoverOutline } from '../dnd/hoverOutline.ts';
import { headingSections } from './headingSections.ts';
import { listItemHandles } from './listItemHandles.ts';
import { isAllChecklist } from './linesChecklist.ts';
import { editorMarkdown, linkHref, notesExtensions } from './tiptapMarkdown.ts';
import { linkAsSmart } from '../../core/smartLinks.ts';
import { createLongPress } from '../smartLinks/longPress.ts';
import { mainHref, openOutside, touchClick } from '../smartLinks/openOutside.ts';
import { SmartLinkMenu, type SmartTarget } from '../smartLinks/SmartLinkMenu.tsx';
import { SmartLinks, smartItemAt } from './smartLinksPlugin.ts';
import type { EditorView } from '@tiptap/pm/view';

/**
 * The smart link (PL-146) or link under a click in the notes: what it is, and where, to select it
 * when nothing can be copied.
 */
function smartAt(
  view: EditorView,
  pos: number,
  target: EventTarget | null,
): (SmartTarget & { from: number; to: number }) | null {
  if (!(target instanceof Element) || !view.dom.contains(target)) return null;
  const link = target.closest('a');
  if (link && view.dom.contains(link)) {
    const item = linkAsSmart(link.getAttribute('href') ?? '');
    if (!item) return null;
    const from = view.posAtDOM(link, 0);
    return { ...item, from, to: from + (link.textContent ?? '').length };
  }
  if (!target.closest('.smart-link')) return null;
  return smartItemAt(view.state, pos);
}

/** The keys that offer a smart item's choices from the keyboard: Alt+Enter, Shift+F10 or the menu key. */
function opensChoices(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey) return false;
  return (
    (event.key === 'Enter' && event.altKey) ||
    (event.key === 'F10' && event.shiftKey) ||
    event.key === 'ContextMenu'
  );
}

/**
 * The smart item or link under the cursor (PL-146): the cursor in it or at either end, or a
 * selection inside it.
 */
function smartAtCaret(view: EditorView): (SmartTarget & { from: number; to: number }) | null {
  const { from, to, $from } = view.state.selection;
  const item = smartItemAt(view.state, from);
  if (item) return from >= item.from && to <= item.to ? item : null;
  const linkType = view.state.schema.marks.link;
  // getMarkRange looks after the cursor, then before it, so either end of a link works ($from.marks()
  // alone takes the text before, missing a link's start).
  const range = linkType && getMarkRange($from, linkType);
  if (!range || from < range.from || to > range.to) return null;
  const link = view.state.doc.nodeAt(range.from)?.marks.find((mark) => mark.type === linkType);
  const smart = link && linkAsSmart(String(link.attrs.href ?? ''));
  if (!smart) return null;
  return { ...smart, from: range.from, to: range.to };
}

/** Where the choices for an item open: just under its start (the notes' own box without layout). */
function anchorAt(view: EditorView, pos: number): { top: number; left: number } {
  try {
    const at = view.coordsAtPos(pos);
    return { top: at.bottom, left: at.left };
  } catch {
    const box = view.dom.getBoundingClientRect();
    return { top: box.top, left: box.left };
  }
}

const SLASH_ICONS: Record<SlashCommandId, ReactNode> = {
  heading1: <HeadingIcon fontSize="small" />,
  heading2: <HeadingIcon fontSize="small" />,
  heading3: <HeadingIcon fontSize="small" />,
  bulletList: <BulletListIcon fontSize="small" />,
  orderedList: <NumberedListIcon fontSize="small" />,
  checklist: <ChecklistIcon fontSize="small" />,
  linesToChecklist: <AllLinesChecklistIcon fontSize="small" />,
  checklistToLines: <NotesLinesIcon fontSize="small" />,
  quote: <QuoteIcon fontSize="small" />,
  codeBlock: <CodeIcon fontSize="small" />,
  divider: <DividerIcon fontSize="small" />,
};
const slashName = (id: SlashCommandId) => t(`editor.slash.${id}`);

/** Height of the inline notes, and of the full editor. */
const INLINE_HEIGHT = 72;
const EXPANDED_HEIGHT = '60vh';

interface SlashMenu {
  items: SlashCommand[];
  index: number;
  rect: (() => DOMRect | null) | null;
  choose: (command: SlashCommand) => void;
}

/** A check mark as a CSS image, in the given color. */
function checkMark(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export default function TiptapEditor({
  value,
  onCommit,
  label,
  placeholder,
  readOnly = false,
  expanded = false,
}: RichTextEditorProps) {
  const theme = useTheme();
  const box = useRef<HTMLDivElement | null>(null);
  const [slash, setSlash] = useState<SlashMenu | null>(null);
  const slashRef = useRef<SlashMenu | null>(null);
  const [bridge] = useState(createSlashMenuBridge);
  // The smart link whose choices are open (PL-146), where it is, and where the click was.
  const [smart, setSmart] = useState<
    | (SmartTarget & {
        from: number;
        to: number;
        anchor: { top: number; left: number };
        /** Opened from the keyboard: the choices take the focus. */
        keys?: boolean;
      })
    | null
  >(null);
  const [longPress] = useState(createLongPress);
  // Choices opened from the keyboard take the focus, and give it back when they close: to the text
  // being edited, or to the item's button in notes that cannot be edited.
  const smartFromKeys = useRef<{ back: HTMLElement | null } | null>(null);
  // A read-only item Space went down on: its choices open on the keyup (handleDOMEvents).
  const spaceOn = useRef<HTMLElement | null>(null);
  // Read out when the cursor comes onto a smart item, with how to open its choices.
  const [caretItem, setCaretItem] = useState('');
  // Whether the notes were being edited when the pointer went down on them: a tap or click then
  // only places the cursor, as on plain text (PL-146).
  const editingAtDown = useRef(false);
  const menuHandlers: SlashMenuHandlers = {
    open: (props) => setSlash(fromSuggestion(props, 0)),
    update: (props) => setSlash(fromSuggestion(props, 0)),
    keyDown: ({ event }) => {
      const menu = slashRef.current;
      if (!menu) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const count = Math.max(menu.items.length, 1);
        setSlash({ ...menu, index: (menu.index + step + count) % count });
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const command = menu.items[menu.index];
        if (!command) return false;
        menu.choose(command);
        return true;
      }
      if (event.key === 'Escape') {
        setSlash(null);
        return true;
      }
      return false;
    },
    close: () => setSlash(null),
  };
  // The editor's "/" hook reads these on each key, so they always see the current menu.
  useLayoutEffect(() => {
    slashRef.current = slash;
    bridge.set(menuHandlers);
  });
  // The markdown the editor shows, and whether the user changed it since.
  const shown = useRef(value);
  const dirty = useRef(false);
  const commitRef = useRef(onCommit);
  useLayoutEffect(() => {
    commitRef.current = onCommit;
  });

  const editor = useEditor({
    extensions: [
      ...notesExtensions(placeholder),
      slashCommandsExtension(bridge, slashName),
      // A handle to move each list item (R-FB-80).
      listItemHandles(t('editor.moveItem'), theme.palette.primary.main),
      headingSections(t('editor.moveSection'), theme.palette.primary.main),
      SmartLinks,
    ],
    content: value,
    contentType: 'markdown',
    editable: !readOnly,
    editorProps: {
      attributes: {
        'aria-label': label,
        'aria-multiline': 'true',
        'aria-readonly': String(readOnly),
        role: 'textbox',
      },
      // Escape leaves the notes (saving them); the next Escape closes the details. ProseMirror
      // would otherwise take it to select the parent block. An open slash menu closes first.
      handleKeyDown: (view, event) => {
        // The choices for the smart item or link under the cursor, from the keyboard (PL-146).
        if (opensChoices(event) && !slashRef.current) {
          const item = smartAtCaret(view);
          if (!item) return false;
          smartFromKeys.current = { back: null };
          setSmart({ ...item, anchor: anchorAt(view, item.from), keys: true });
          return true;
        }
        if (event.key !== 'Escape' || slashRef.current) return false;
        view.dom.blur();
        return true;
      },
      // Links and smart links (PL-146), while the notes are not being edited: a tap does the main
      // thing (call, open the page or the maps app); a click with the mouse offers the choices
      // for it, in a popover that leaves the focus in the text and still places the cursor. While
      // they are being edited, a tap or click only places the cursor, as on plain text. Ctrl or
      // Cmd + click opens a link straight away; a long press offers the choices on any screen.
      handleClick: (view, pos, event) => {
        // The end of a long press, which opened the choices already.
        if (longPress.takeFired()) return true;
        if (event.button !== 0 || event.shiftKey || event.altKey) return false;
        const item = smartAt(view, pos, event.target);
        if (!item) return false;
        const href = item.href ?? mainHref(item.kind, item.text);
        if (event.ctrlKey || event.metaKey) {
          openOutside(href);
          return true;
        }
        if (editingAtDown.current) return false;
        if (touchClick(event)) {
          openOutside(href);
          // No keyboard over the dialer or the map on the way back.
          view.dom.blur();
          return true;
        }
        // A double or triple click selects, as ever.
        if (event.detail > 1) return false;
        setSmart({ ...item, anchor: { top: event.clientY, left: event.clientX } });
        return false;
      },
      handleDOMEvents: {
        // In notes that cannot be edited each item is a button (smartLinksPlugin): Enter or Space
        // on it offers its choices. Notes being edited take the keys in handleKeyDown.
        keydown: (view, event) => {
          if (view.editable) return false;
          if (event.key !== 'Enter' && event.key !== ' ' && !opensChoices(event)) return false;
          const button = smartButton(view, event.target);
          if (!button || !smartItemAt(view.state, view.posAtDOM(button, 0))) return false;
          event.preventDefault();
          // Space offers them on its keyup, as a native button acts: offered on the keydown, the
          // first choice has the focus by the keyup, and MUI's menu item takes a Space keyup as a
          // press, so "Call" would dial at once (QA).
          if (event.key === ' ') {
            spaceOn.current = button;
            return true;
          }
          return offerFromKeys(view, button);
        },
        keyup: (view, event) => {
          if (view.editable || event.key !== ' ') return false;
          const button = spaceOn.current;
          spaceOn.current = null;
          if (!button || smartButton(view, event.target) !== button) return false;
          event.preventDefault();
          return offerFromKeys(view, button);
        },
        // A long press on a touch screen offers the choices (longPress.ts).
        pointerdown: (view, event) => {
          editingAtDown.current = view.hasFocus();
          const target = event.target;
          if (!(target instanceof Element) || !view.dom.contains(target)) return false;
          const item = smartAt(view, view.posAtDOM(target, 0), target);
          if (!item) {
            longPress.cancel();
            longPress.takeFired();
            return false;
          }
          const anchor = { top: event.clientY, left: event.clientX };
          longPress.down(event, () => setSmart({ ...item, anchor }));
          return false;
        },
        pointermove: (_view, event) => {
          longPress.move(event);
          return false;
        },
        pointerup: () => {
          longPress.cancel();
          return false;
        },
        pointercancel: () => {
          longPress.cancel();
          return false;
        },
        // A long press where the browser reports one as a context menu offers the choices; a
        // right-click with the mouse keeps the browser's own menu (spelling, paste, copy link).
        contextmenu: (view, event) => {
          if (!touchClick(event)) return false;
          const target = event.target;
          if (!(target instanceof Element) || !view.dom.contains(target)) return false;
          const item = smartAt(view, view.posAtDOM(target, 0), target);
          if (!item) return false;
          event.preventDefault();
          setSmart({ ...item, anchor: { top: event.clientY, left: event.clientX } });
          return true;
        },
      },
    },
    onUpdate: ({ editor }) => {
      dirty.current = true;
      // A box ticked without focus (no blur will follow): keep it now.
      if (!editor.isFocused) commit(editor);
    },
    onBlur: ({ editor }) => {
      setCaretItem('');
      commit(editor);
    },
    // The cursor moved onto a smart item: say what it is and how to open its choices, once per
    // arrival (typing inside it keeps the same words, so nothing is read out at each key).
    onSelectionUpdate: ({ editor, transaction }) => {
      if (transaction.docChanged) return;
      const { selection } = editor.state;
      const item =
        editor.isFocused && selection.empty ? smartItemAt(editor.state, selection.from) : null;
      setCaretItem(
        item
          ? t('smartLinks.atCaret', { kind: t(`smartLinks.kind.${item.kind}`), text: item.text })
          : '',
      );
    },
  });
  // The read-only item (a button, smartLinksPlugin) a key event is on, if it is one.
  function smartButton(view: EditorView, target: EventTarget | null): HTMLElement | null {
    const button = target instanceof Element ? target.closest('.smart-link') : null;
    return button instanceof HTMLElement && view.dom.contains(button) ? button : null;
  }
  // A read-only item's choices from the keyboard, the focus back on it when they close.
  function offerFromKeys(view: EditorView, button: HTMLElement): boolean {
    const item = smartItemAt(view.state, view.posAtDOM(button, 0));
    if (!item) return false;
    const rect = button.getBoundingClientRect();
    smartFromKeys.current = { back: button };
    setSmart({ ...item, anchor: { top: rect.bottom, left: rect.left }, keys: true });
    return true;
  }
  // The choices closed: back to where the keyboard was, if they were opened from it.
  const closeSmart = useCallback(() => {
    setSmart(null);
    const from = smartFromKeys.current;
    smartFromKeys.current = null;
    if (!from) return;
    if (from.back?.isConnected) from.back.focus();
    else editor?.commands.focus();
  }, [editor]);
  // A click elsewhere put the focus where the person clicked: leave it there.
  const clickAwaySmart = useCallback(() => {
    smartFromKeys.current = null;
    setSmart(null);
  }, []);

  function commit(target: Editor) {
    if (!dirty.current) return;
    dirty.current = false;
    const markdown = editorMarkdown(target);
    if (markdown === shown.current) return;
    shown.current = markdown;
    commitRef.current(markdown);
  }

  // Outside changes (undo, another device) replace the text.
  useEffect(() => {
    if (!editor || value === shown.current) return;
    shown.current = value;
    dirty.current = false;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  // Leaving without a blur still keeps the edit: the panel closes, or the page is hidden or
  // closed (capture phase, so this runs before the store flushes to disk on the same events).
  useEffect(() => {
    if (!editor) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') commit(editor);
    };
    const onPageHide = () => commit(editor);
    window.addEventListener('visibilitychange', onHide, true);
    window.addEventListener('pagehide', onPageHide, true);
    return () => {
      window.removeEventListener('visibilitychange', onHide, true);
      window.removeEventListener('pagehide', onPageHide, true);
      commit(editor);
    };
  }, [editor]);

  // Checklist boxes tick without the editor taking focus: no caret, no keyboard on a phone, and
  // the text stays where it is. TipTap's own handler would focus the editor, so this runs first.
  useEffect(() => {
    const element = box.current;
    if (!editor || !element) return;
    const isCheckbox = (target: EventTarget | null): target is HTMLInputElement =>
      target instanceof HTMLInputElement &&
      target.type === 'checkbox' &&
      target.closest('ul[data-type=taskList] > li') !== null;
    const onMouseDown = (event: MouseEvent) => {
      if (isCheckbox(event.target)) event.preventDefault();
    };
    // The box toggles itself; the change stops here, before TipTap's own listener (which focuses).
    const onChange = (event: Event) => {
      if (!isCheckbox(event.target) || !editor.isEditable) return;
      event.stopPropagation();
      const checked = event.target.checked;
      const { view } = editor;
      const $at = view.state.doc.resolve(view.posAtDOM(event.target, 0));
      for (let depth = $at.depth; depth > 0; depth--) {
        const node = $at.node(depth);
        if (node.type.name !== 'taskItem') continue;
        view.dispatch(
          view.state.tr.setNodeMarkup($at.before(depth), undefined, { ...node.attrs, checked }),
        );
        return;
      }
    };
    element.addEventListener('mousedown', onMouseDown, true);
    element.addEventListener('change', onChange, true);
    return () => {
      element.removeEventListener('mousedown', onMouseDown, true);
      element.removeEventListener('change', onChange, true);
    };
  }, [editor]);

  return (
    <Box
      ref={box}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 1,
        px: expanded ? 0 : 1,
        py: expanded ? 0 : 0.75,
        mx: expanded ? 0 : -1,
        minHeight: expanded ? EXPANDED_HEIGHT : INLINE_HEIGHT,
        cursor: 'text',
        transition: theme.transitions.create('background-color', {
          duration: theme.transitions.duration.shorter,
        }),
        '& > .content': { flexGrow: 1, display: 'flex', flexDirection: 'column' },
        '& > .content > div': { flexGrow: 1, display: 'flex', flexDirection: 'column' },
        ...(expanded || readOnly ? {} : { '&:hover': { bgcolor: 'action.hover' } }),
        '& .tiptap': {
          ...theme.typography.body2,
          outline: 'none',
          flexGrow: 1,
          minHeight: expanded ? 0 : INLINE_HEIGHT - 12,
          wordBreak: 'break-word',
          // First-of-type (not first-child, which is unsafe for server rendering); margins collapse,
          // so clearing the top of later blocks of a type changes nothing.
          '& > :first-of-type': { mt: 0 },
          '& > :last-child': { mb: 0 },
          '& p': { my: 0.75 },
          '& h1': { ...theme.typography.h6, my: 1 },
          '& h2': { ...theme.typography.subtitle1, fontWeight: 700, my: 1 },
          '& h3': { ...theme.typography.subtitle2, fontWeight: 700, my: 0.75 },
          // Each heading's handle at its right moves its whole section (headingSections).
          '& h1, & h2, & h3': { position: 'relative', pr: 3 },
          '& h1:hover > .note-item-handle, & h2:hover > .note-item-handle, & h3:hover > .note-item-handle':
            { opacity: 0.8 },
          // A divider, the full width (Ben, 2026-11-02: it did not show). The browser's own has
          // auto side margins, which in the editor's flex column shrink it to nothing.
          '& hr': {
            border: 0,
            borderTop: '1px solid',
            borderColor: 'text.disabled',
            mx: 0,
            my: 1.5,
            width: '100%',
          },
          '& ul, & ol': { my: 0.75, pl: 3 },
          '& li > p': { my: 0.25 },
          // Each item's handle at its right (R-FB-80): room kept for it, shown on hover (and
          // always on touch screens); none when the notes are read only.
          '& li': { position: 'relative', pr: 3 },
          '& .note-item-handle': {
            position: 'absolute',
            right: 0,
            top: 0,
            width: 22,
            height: `${theme.typography.body2.lineHeight}em`,
            display: 'grid',
            placeItems: 'center',
            color: 'text.secondary',
            cursor: 'grab',
            touchAction: 'none',
            userSelect: 'none',
            opacity: 0,
            transition: 'opacity 120ms',
            '@media (hover: none)': { opacity: 0.6 },
          },
          '& li:hover > .note-item-handle, & li:hover > div > .note-item-handle': { opacity: 0.8 },
          '&[contenteditable=false] .note-item-handle': { display: 'none' },
          // The item under the mouse gets the subtasks' light outline (R-FB-89); only the innermost
          // one when lists nest.
          '@media (hover: hover)': {
            '&[contenteditable=true] li:hover:not(:has(li:hover))': {
              boxShadow: hoverOutline(theme),
              borderRadius: 1,
            },
          },
          // Links, and the smart links found in the text (PL-146): a click offers what to do.
          '& a, & .smart-link': {
            color: 'primary.main',
            textDecoration: 'underline',
            textDecorationThickness: '1px',
            textUnderlineOffset: '2px',
            cursor: 'pointer',
          },
          '& code': {
            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
            fontSize: '0.9em',
            px: 0.5,
            borderRadius: 0.5,
            bgcolor: 'action.hover',
          },
          '& pre': {
            p: 1,
            borderRadius: 1,
            bgcolor: 'action.hover',
            overflowX: 'auto',
            '& code': { p: 0, bgcolor: 'transparent' },
          },
          '& blockquote': {
            my: 0.75,
            mx: 0,
            pl: 1.5,
            borderLeft: 3,
            borderColor: 'divider',
            color: 'text.secondary',
          },
          // Checklists: a box per line, done lines struck through.
          '& ul[data-type=taskList]': { listStyle: 'none', pl: 0.25 },
          '& ul[data-type=taskList] li': {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.5,
            // Room between rows, so each box is easy to hit on its own (Ben, 2026-11-01).
            my: 1.5,
            // The box is centered on the first line of text: the label is one line tall.
            '& > label': {
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              height: `${theme.typography.body2.lineHeight}em`,
              // A bigger target than the box: the label around it toggles it too.
              p: '8px',
              m: '-8px',
              boxSizing: 'content-box',
              cursor: 'pointer',
            },
            '& > div': { flex: 1, minWidth: 0 },
            '& > div > p': { my: 0 },
            // Drawn like the task-row checkbox: a rounded square, filled grey with a check.
            '& input': {
              appearance: 'none',
              boxSizing: 'border-box',
              m: 0,
              width: 22,
              height: 22,
              borderRadius: '6px',
              border: `1.5px solid ${theme.palette.text.secondary}`,
              [theme.breakpoints.down('md')]: { width: 24, height: 24 },
              cursor: 'pointer',
              '&:checked': {
                borderColor: theme.palette.text.disabled,
                bgcolor: theme.palette.text.disabled,
                backgroundImage: checkMark(theme.palette.background.paper),
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                backgroundSize: '15px',
              },
              '&:focus-visible': {
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: 1,
              },
            },
          },
          '& li[data-checked=true] > div': {
            color: 'text.secondary',
            textDecoration: 'line-through',
          },
          '& p.is-editor-empty:first-of-type::before': {
            content: 'attr(data-placeholder)',
            float: 'left',
            height: 0,
            pointerEvents: 'none',
            color: 'text.disabled',
          },
        },
      }}
      // Clicks on the padding still place the cursor.
      onMouseDown={(event) => {
        if (editor && event.target === event.currentTarget) {
          event.preventDefault();
          editor.commands.focus('end');
        }
      }}
    >
      {editor && expanded && !readOnly && <FormatToolbar editor={editor} />}
      <EditorContent editor={editor} className="content" />
      <Box component="span" role="status" sx={visuallyHidden}>
        {caretItem}
      </Box>
      <SmartLinkMenu
        inText
        target={smart}
        anchor={smart?.anchor ?? null}
        onClose={closeSmart}
        onClickAway={clickAwaySmart}
        // A choice used leaves the notes, so the next click on a link offers its choices again
        // (QA 0.13.0): kept focus would make every later click "editing", placing the cursor only.
        // From the keyboard, the focus goes back to the text instead (closeSmart).
        onChose={() => {
          if (!smart?.keys) editor?.view.dom.blur();
        }}
        takeFocus={!!smart?.keys}
        onCopyFailed={() => {
          // No clipboard here: the text selected, for a copy by hand.
          if (editor && smart) {
            editor.chain().focus().setTextSelection({ from: smart.from, to: smart.to }).run();
          }
        }}
      />
      {slash && (
        <Popper
          open
          placement="bottom-start"
          anchorEl={{ getBoundingClientRect: () => slash.rect?.() ?? new DOMRect() }}
          sx={{ zIndex: theme.zIndex.modal + 1 }}
        >
          <Paper
            elevation={6}
            sx={{ borderRadius: 2, maxHeight: 320, overflowY: 'auto', minWidth: 220 }}
          >
            <MenuList dense aria-label={t('editor.slash.menu')}>
              {slash.items.length === 0 ? (
                <MenuItem disabled>{t('editor.slash.none')}</MenuItem>
              ) : (
                slash.items.map((command, index) => (
                  <MenuItem
                    key={command.id}
                    selected={index === slash.index}
                    // Keep focus in the text.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => slash.choose(command)}
                  >
                    <ListItemIcon>{SLASH_ICONS[command.id]}</ListItemIcon>
                    <ListItemText>{slashName(command.id)}</ListItemText>
                  </MenuItem>
                ))
              )}
            </MenuList>
          </Paper>
        </Popper>
      )}
    </Box>
  );
}

function fromSuggestion(props: SuggestionProps<SlashCommand>, index: number): SlashMenu {
  return {
    items: props.items,
    index,
    rect: props.clientRect ?? null,
    choose: (command) => props.command(command),
  };
}

/** Formatting buttons along the top of the box while it has focus. */
function FormatToolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false);
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
      heading: editor.isActive('heading'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      taskList: editor.isActive('taskList'),
      allChecklist: isAllChecklist(editor.state.doc),
      link: editor.isActive('link'),
      hasSelection: !editor.state.selection.empty,
    }),
  });

  const button = (
    key: Exclude<keyof typeof active, 'hasSelection'>,
    name: string,
    icon: ReactNode,
    run: () => void,
    disabled = false,
  ) => (
    <Tooltip key={key} title={name} describeChild>
      <span>
        <IconButton
          size="small"
          aria-label={name}
          aria-pressed={active[key]}
          disabled={disabled}
          // Keep the selection: act without taking focus from the text.
          onMouseDown={(event) => event.preventDefault()}
          onClick={run}
          sx={{
            borderRadius: 1,
            color: active[key] ? 'primary.main' : 'text.secondary',
            bgcolor: active[key] ? 'action.selected' : undefined,
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
  const chain = () => editor.chain().focus();

  return (
    <Box
      role="toolbar"
      aria-label={t('editor.formatting')}
      sx={{
        // Stays at the top of the full editor while the notes scroll under it, on the dialog's
        // own surface (its dark-mode overlay included, through the Paper's variable).
        position: 'sticky',
        top: 0,
        zIndex: 1,
        bgcolor: 'background.paper',
        backgroundImage: 'var(--Paper-overlay)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.25,
        mx: -0.75,
        mt: -0.5,
        mb: 0.75,
        pb: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        cursor: 'default',
      }}
    >
      {linking ? (
        <LinkField
          onDone={(input) => {
            setLinking(false);
            const href = input === null ? null : linkHref(input);
            if (!href) {
              chain().run();
              return;
            }
            // A double-click often takes the space after a word; keep it out of the link.
            const { from, to } = trimmedSelection(editor);
            chain().setTextSelection({ from, to }).setLink({ href }).setTextSelection(to).run();
          }}
        />
      ) : (
        <>
          {button('bold', t('editor.bold'), <BoldIcon fontSize="small" />, () =>
            chain().toggleBold().run(),
          )}
          {button('italic', t('editor.italic'), <ItalicIcon fontSize="small" />, () =>
            chain().toggleItalic().run(),
          )}
          {button('strike', t('editor.strike'), <StrikeIcon fontSize="small" />, () =>
            chain().toggleStrike().run(),
          )}
          {button('code', t('editor.code'), <CodeIcon fontSize="small" />, () =>
            chain().toggleCode().run(),
          )}
          <Divider />
          {button('heading', t('editor.heading'), <HeadingIcon fontSize="small" />, () =>
            chain().toggleHeading({ level: 2 }).run(),
          )}
          {button('bulletList', t('editor.bulletList'), <BulletListIcon fontSize="small" />, () =>
            chain().toggleBulletList().run(),
          )}
          {button(
            'orderedList',
            t('editor.slash.orderedList'),
            <NumberedListIcon fontSize="small" />,
            () => chain().toggleOrderedList().run(),
          )}
          {button('taskList', t('editor.checklist'), <ChecklistIcon fontSize="small" />, () =>
            chain().toggleTaskList().run(),
          )}
          {/* The whole note, one box per line, and back (a toggle: pressed while it is all boxes). */}
          {button(
            'allChecklist',
            active.allChecklist ? t('editor.checklistToLines') : t('editor.linesToChecklist'),
            active.allChecklist ? (
              <NotesLinesIcon fontSize="small" />
            ) : (
              <AllLinesChecklistIcon fontSize="small" />
            ),
            () =>
              (active.allChecklist ? chain().checklistToLines() : chain().linesToChecklist()).run(),
          )}
          <Divider />
          {button(
            'link',
            t('editor.link'),
            <LinkIcon fontSize="small" />,
            () => {
              if (active.link) chain().extendMarkRange('link').unsetLink().run();
              else setLinking(true);
            },
            // A new link needs selected text to go on.
            !active.link && !active.hasSelection,
          )}
        </>
      )}
    </Box>
  );
}

/** The selection without spaces at either end. */
function trimmedSelection(editor: Editor): { from: number; to: number } {
  let { from, to } = editor.state.selection;
  const charAt = (at: number) => editor.state.doc.textBetween(at, at + 1);
  while (from < to && /\s/.test(charAt(from))) from++;
  while (to > from && /\s/.test(charAt(to - 1))) to--;
  return { from, to };
}

function Divider() {
  return <Box sx={{ width: '1px', alignSelf: 'stretch', my: 0.5, mx: 0.25, bgcolor: 'divider' }} />;
}

/** The link address, typed in place of the toolbar. Enter applies; Escape cancels. */
function LinkField({ onDone }: { onDone: (href: string | null) => void }) {
  const [href, setHref] = useState('');
  return (
    <InputBase
      autoFocus
      value={href}
      placeholder={t('editor.linkPlaceholder')}
      inputProps={{ 'aria-label': t('editor.linkAddress') }}
      onChange={(event) => setHref(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onDone(href);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onDone(null);
        }
      }}
      onBlur={() => onDone(null)}
      sx={{ px: 1, width: 240, typography: 'body2' }}
    />
  );
}

/** Read out by a screen reader, not shown. */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
