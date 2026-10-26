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
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { SuggestionProps } from '@tiptap/suggestion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { RichTextEditorProps } from '../../ports/richText.ts';
import { t } from '../i18n/i18n.ts';
import {
  BoldIcon,
  BulletListIcon,
  ChecklistIcon,
  CodeIcon,
  DividerIcon,
  HeadingIcon,
  ItalicIcon,
  LinkIcon,
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
import { listItemHandles } from './listItemHandles.ts';
import { editorMarkdown, linkHref, notesExtensions } from './tiptapMarkdown.ts';

const SLASH_ICONS: Record<SlashCommandId, ReactNode> = {
  heading1: <HeadingIcon fontSize="small" />,
  heading2: <HeadingIcon fontSize="small" />,
  heading3: <HeadingIcon fontSize="small" />,
  bulletList: <BulletListIcon fontSize="small" />,
  orderedList: <NumberedListIcon fontSize="small" />,
  checklist: <ChecklistIcon fontSize="small" />,
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
        if (event.key !== 'Escape' || slashRef.current) return false;
        view.dom.blur();
        return true;
      },
      // Links edit like text; Ctrl or Cmd + click opens one.
      handleClick: (_view, _pos, event) => {
        const link = (event.target as HTMLElement).closest('a');
        if (link?.href && (event.ctrlKey || event.metaKey)) {
          window.open(link.href, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      dirty.current = true;
      // A box ticked without focus (no blur will follow): keep it now.
      if (!editor.isFocused) commit(editor);
    },
    onBlur: ({ editor }) => commit(editor),
  });

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
          '& a': { color: 'primary.main', textDecoration: 'underline', cursor: 'text' },
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
            gap: 1,
            my: 0.25,
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
              width: 18,
              height: 18,
              borderRadius: '5px',
              border: `1.5px solid ${theme.palette.text.secondary}`,
              [theme.breakpoints.down('md')]: { width: 20, height: 20 },
              cursor: 'pointer',
              '&:checked': {
                borderColor: theme.palette.text.disabled,
                bgcolor: theme.palette.text.disabled,
                backgroundImage: checkMark(theme.palette.background.paper),
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                backgroundSize: '13px',
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
