import { Box } from '@mui/material';
import { lazy, Suspense } from 'react';
import type { RichTextEditorProps } from '../../ports/richText.ts';

// The editor library loads on first use, keeping it out of the app's first load.
const Editor = lazy(() => import('./TiptapEditor.tsx'));

/** The notes editor (the RichTextEditor port, backed by TipTap). */
export function NotesEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={
        <Box
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            px: 1.5,
            py: 1,
            minHeight: 96,
            typography: 'body2',
            whiteSpace: 'pre-wrap',
            color: props.value ? 'text.primary' : 'text.disabled',
          }}
        >
          {props.value || props.placeholder}
        </Box>
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
