import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Suspense, useState } from 'react';
import type { RichTextEditorProps } from '../../ports/richText.ts';
import { t } from '../i18n/i18n.ts';
import { lazyAgain } from '../lazyAgain.tsx';
import { LoadBoundary } from '../layout/LoadBoundary.tsx';
import { preloadEditor } from './preloadEditor.ts';
import { intlLocale } from '../../core/intl.ts';
import { visuallyHidden } from '../layout/visuallyHidden.ts';

// The editor library loads on first use, keeping it out of the app's first load; the app fetches
// it ahead once idle (preloadEditor), so opening a task does not wait for it. One that could not
// load is asked for again the next time a task opens.
const Editor = lazyAgain(preloadEditor);

function Fallback({ value, placeholder }: { value: string; placeholder: string | undefined }) {
  return (
    <Box
      sx={{
        minHeight: 72,
        py: 0.75,
        typography: 'body2',
        whiteSpace: 'pre-wrap',
        color: value ? 'text.primary' : 'text.disabled',
      }}
    >
      {value || placeholder}
    </Box>
  );
}

/** The editor could not be fetched: the notes as text, and Reload to get the editor back. */
function LoadFailed({ value, placeholder }: { value: string; placeholder: string | undefined }) {
  return (
    <Box>
      <Fallback value={value} placeholder={placeholder} />
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 1,
          typography: 'caption',
          color: 'text.secondary',
        }}
      >
        {t('editor.loadFailed')}
        <Button size="small" onClick={() => window.location.reload()}>
          {t('crash.reload')}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * The notes (the RichTextEditor port, backed by TipTap), like TickTick's: always editable where
 * they are, with no edit mode, and a small button in the bottom right that opens the full editor
 * with its formatting toolbar (spec: PL-016). With `maxLength`, notes saved longer than that (and
 * so cut by the store) say so quietly at the editor's edge, and the editor shows what was kept.
 */
export function NotesEditor(props: RichTextEditorProps & { title?: string; maxLength?: number }) {
  const { title, maxLength, ...rest } = props;
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [full, setFull] = useState(false);
  // The last save was longer than maxLength, and a count that remounts the editor after one.
  const [cut, setCut] = useState(false);
  const [kept, setKept] = useState(0);
  const editor: RichTextEditorProps = {
    ...rest,
    onCommit: (markdown) => {
      const over = maxLength !== undefined && markdown.length > maxLength;
      setCut(over);
      rest.onCommit(markdown);
      // The editor takes a new value only when the stored text changes, and a second cut stores
      // the same text, so the part past the limit stayed on screen until a reload (QA).
      if (over) setKept((count) => count + 1);
    },
  };
  const limit =
    cut && maxLength !== undefined && !editor.readOnly
      ? t('editor.notesLimit', { count: maxLength.toLocaleString(intlLocale()) })
      : null;
  return (
    <Box sx={{ position: 'relative' }}>
      <LoadBoundary fallback={<LoadFailed value={editor.value} placeholder={editor.placeholder} />}>
        <Suspense fallback={<Fallback value={editor.value} placeholder={editor.placeholder} />}>
          <Editor key={kept} {...editor} />
        </Suspense>
      </LoadBoundary>
      {/* Always there, so a screen reader reads the message out when it arrives (a live region
          that appears already filled is often skipped). */}
      {!editor.readOnly && maxLength !== undefined && (
        <Box component="span" role="status" data-notes-limit="" sx={visuallyHidden}>
          {limit ?? ''}
        </Box>
      )}
      {limit && (
        // A small label over the editor's bottom edge, beside the full-editor button, so nothing
        // moves. Notes this long fill the editor, so it covers only the end of them.
        <Typography
          aria-hidden
          variant="caption"
          color="text.secondary"
          sx={{
            position: 'absolute',
            left: -4,
            bottom: 2,
            maxWidth: 'calc(100% - 32px)',
            px: 1,
            py: 0.25,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.default',
            pointerEvents: 'none',
          }}
        >
          {limit}
        </Typography>
      )}
      {!editor.readOnly && (
        <Tooltip title={t('editor.openFull')}>
          <IconButton
            size="small"
            aria-label={t('editor.openFull')}
            onClick={() => setFull(true)}
            sx={{ position: 'absolute', right: -6, bottom: -6, color: 'text.disabled' }}
          >
            <OpenInFullRounded sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      {full && (
        <Dialog open onClose={() => setFull(false)} fullScreen={phone} fullWidth maxWidth="md">
          <DialogTitle sx={{ pb: 1 }}>{title || t('editor.fullTitle')}</DialogTitle>
          <DialogContent>
            <LoadBoundary
              fallback={<LoadFailed value={editor.value} placeholder={editor.placeholder} />}
            >
              <Suspense
                fallback={<Fallback value={editor.value} placeholder={editor.placeholder} />}
              >
                <Editor key={kept} {...editor} expanded />
              </Suspense>
            </LoadBoundary>
          </DialogContent>
          <DialogActions sx={{ justifyContent: limit ? 'space-between' : undefined, gap: 1 }}>
            {/* Always there for the same reason: the open dialog hides the page's own from a
                screen reader. Empty, it takes no room. */}
            {maxLength !== undefined && !editor.readOnly && (
              <Typography role="status" variant="caption" color="text.secondary" sx={{ pl: 2 }}>
                {limit ?? ''}
              </Typography>
            )}
            <Button onClick={() => setFull(false)}>{t('common.done')}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
