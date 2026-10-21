// The RichTextEditor adapter for TipTap: formats as you type (`**bold**`, `- list`, `# heading`,
// `[ ] ` checklist) and hands back plain markdown. A small toolbar floats over a selection on
// larger screens; phones get none.

import { Box, IconButton, InputBase, Paper, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { RichTextEditorProps } from '../../ports/richText.ts';
import { t } from '../i18n/i18n.ts';
import {
  BoldIcon,
  BulletListIcon,
  ChecklistIcon,
  CodeIcon,
  HeadingIcon,
  ItalicIcon,
  LinkIcon,
  StrikeIcon,
} from '../icons/icons.tsx';
import { editorMarkdown, linkHref, notesExtensions } from './tiptapMarkdown.ts';

/** A check mark as a CSS image, in the given color. */
function checkMark(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export default function TiptapEditor({ value, onCommit, label, placeholder }: RichTextEditorProps) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  // The markdown the editor shows, and whether the user changed it since.
  const shown = useRef(value);
  const dirty = useRef(false);
  const commitRef = useRef(onCommit);
  useLayoutEffect(() => {
    commitRef.current = onCommit;
  });

  const editor = useEditor({
    extensions: notesExtensions(placeholder),
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        'aria-label': label,
        'aria-multiline': 'true',
        role: 'textbox',
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
    onUpdate: () => {
      dirty.current = true;
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

  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        px: 1.5,
        py: 1,
        minHeight: 96,
        cursor: 'text',
        transition: theme.transitions.create('border-color'),
        '&:hover': { borderColor: 'text.secondary' },
        '&:focus-within': {
          borderColor: 'primary.main',
          boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}`,
        },
        '& .tiptap': {
          ...theme.typography.body2,
          outline: 'none',
          minHeight: 78,
          wordBreak: 'break-word',
          '& > :first-child': { mt: 0 },
          '& > :last-child': { mb: 0 },
          '& p': { my: 0.75 },
          '& h1': { ...theme.typography.h6, my: 1 },
          '& h2': { ...theme.typography.subtitle1, fontWeight: 700, my: 1 },
          '& h3': { ...theme.typography.subtitle2, fontWeight: 700, my: 0.75 },
          '& ul, & ol': { my: 0.75, pl: 3 },
          '& li > p': { my: 0.25 },
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
            },
            '& > div': { flex: 1, minWidth: 0 },
            '& > div > p': { my: 0 },
            // Drawn like the task-row checkbox: a rounded square, filled grey with a check.
            '& input': {
              appearance: 'none',
              boxSizing: 'border-box',
              m: 0,
              width: 15,
              height: 15,
              borderRadius: '4px',
              border: `1.5px solid ${theme.palette.text.secondary}`,
              cursor: 'pointer',
              '&:checked': {
                borderColor: theme.palette.text.disabled,
                bgcolor: theme.palette.text.disabled,
                backgroundImage: checkMark(theme.palette.background.paper),
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                backgroundSize: '11px',
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
      <EditorContent editor={editor} />
      {editor && !phone && <SelectionToolbar editor={editor} />}
    </Box>
  );
}

/** The floating toolbar over a text selection. */
function SelectionToolbar({ editor }: { editor: Editor }) {
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
      taskList: editor.isActive('taskList'),
      link: editor.isActive('link'),
    }),
  });

  const button = (key: keyof typeof active, name: string, icon: ReactNode, run: () => void) => (
    <Tooltip key={key} title={name} describeChild>
      <IconButton
        size="small"
        aria-label={name}
        aria-pressed={active[key]}
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
    </Tooltip>
  );
  const chain = () => editor.chain().focus();

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor, from, to }) =>
        linking || (editor.isFocused && from !== to && !editor.isActive('codeBlock'))
      }
    >
      <Paper
        elevation={4}
        role="toolbar"
        aria-label={t('editor.formatting')}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.25, p: 0.5, borderRadius: 2 }}
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
            {button('taskList', t('editor.checklist'), <ChecklistIcon fontSize="small" />, () =>
              chain().toggleTaskList().run(),
            )}
            <Divider />
            {button('link', t('editor.link'), <LinkIcon fontSize="small" />, () => {
              if (active.link) chain().extendMarkRange('link').unsetLink().run();
              else setLinking(true);
            })}
          </>
        )}
      </Paper>
    </BubbleMenu>
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
