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

// The editor library loads on first use, keeping it out of the app's first load.
const Editor = lazy(() => import('./TiptapEditor.tsx'));

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
      <Suspense fallback={<Fallback value={editor.value} placeholder={editor.placeholder} />}>
        <Editor {...editor} />
      </Suspense>
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
            <Suspense fallback={<Fallback value={editor.value} placeholder={editor.placeholder} />}>
              <Editor {...editor} expanded />
            </Suspense>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFull(false)}>{t('common.done')}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
