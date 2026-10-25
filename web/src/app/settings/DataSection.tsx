import { Alert, Box, Button } from '@mui/material';
import { useRef, useState } from 'react';
import { parseJson } from '../../core/io.ts';
import { serializeWorkspace } from '../../core/workspace.ts';
import { t } from '../i18n/i18n.ts';
import { useWorkspaceStore } from '../store/hooks.ts';
import { ExportDialog, ImportDialog } from './InterchangeDialogs.tsx';
import { Section } from './settingsLayout.tsx';

/** `punchlist-2026-10-23.json`, by this device's date. */
function fileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `punchlist-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * Settings > Your data (spec: local storage, export and import): download everything as one JSON
 * file, or bring one in. An import merges, so it never loses what is here. Other apps' files come
 * in and go out through their own dialogs (PL-063).
 */
export function DataSection() {
  const store = useWorkspaceStore();
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<'import' | 'export' | null>(null);

  const download = () => {
    const workspace = store.getState().workspace;
    if (!workspace) return;
    const blob = new Blob([serializeWorkspace(workspace)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const bringIn = async (file: File) => {
    setNotice(null);
    const parsed = parseJson(await file.text());
    if (!parsed.ok) {
      setNotice({ ok: false, text: t('settings.data.notJson') });
      return;
    }
    const outcome = store.getState().importDocument(parsed.value, t('undo.imported'));
    if (outcome.kind === 'newer') {
      setNotice({ ok: false, text: t('settings.data.newer') });
    } else if (outcome.kind === 'invalid') {
      setNotice({
        ok: false,
        text: t('settings.data.invalid', { reason: outcome.errors.slice(0, 2).join('; ') }),
      });
    } else {
      setNotice({
        ok: true,
        text: t('settings.data.imported', {
          tasks: outcome.tasks,
          lists: outcome.lists,
          tags: outcome.tags,
        }),
      });
    }
  };

  return (
    <Section title={t('settings.data')} hint={t('settings.data.hint')}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={download}>
          {t('settings.data.download')}
        </Button>
        <Button variant="outlined" onClick={() => input.current?.click()}>
          {t('settings.data.import')}
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          aria-label={t('settings.data.import')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void bringIn(file);
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
        <Button variant="outlined" onClick={() => setOpen('import')}>
          {t('settings.data.fromApp')}
        </Button>
        <Button variant="outlined" onClick={() => setOpen('export')}>
          {t('settings.data.forApp')}
        </Button>
      </Box>
      {open === 'import' && (
        <ImportDialog
          onClose={() => setOpen(null)}
          onDone={(text) => setNotice({ ok: true, text })}
        />
      )}
      {open === 'export' && <ExportDialog onClose={() => setOpen(null)} />}
      {notice && (
        <Alert
          severity={notice.ok ? 'success' : 'error'}
          variant="outlined"
          sx={{ mt: 1.5 }}
          onClose={() => setNotice(null)}
        >
          {notice.text}
        </Alert>
      )}
    </Section>
  );
}
