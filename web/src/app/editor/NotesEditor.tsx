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
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { lazy, Suspense, useState } from 'react';
import type { RichTextEditorProps } from '../../ports/richText.ts';
import { t } from '../i18n/i18n.ts';
import { LoadBoundary } from '../layout/LoadBoundary.tsx';
import { preloadEditor } from './preloadEditor.ts';

// The editor library loads on first use, keeping it out of the app's first load; the app fetches
// it ahead once idle (preloadEditor), so opening a task does not wait for it.
const Editor = lazy(preloadEditor);

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
 * with its formatting toolbar (spec: PL-016).
 */
export function NotesEditor(props: RichTextEditorProps & { title?: string }) {
  const { title, ...editor } = props;
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [full, setFull] = useState(false);
  return (
    <Box sx={{ position: 'relative' }}>
      <LoadBoundary fallback={<LoadFailed value={editor.value} placeholder={editor.placeholder} />}>
        <Suspense fallback={<Fallback value={editor.value} placeholder={editor.placeholder} />}>
          <Editor {...editor} />
        </Suspense>
      </LoadBoundary>
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
                <Editor {...editor} expanded />
              </Suspense>
            </LoadBoundary>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFull(false)}>{t('common.done')}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
