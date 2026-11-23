import { Alert, Button } from '@mui/material';
import { useRef, useState } from 'react';
import { parseJson } from '../../core/io.ts';
import { t } from '../i18n/i18n.ts';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { useWorkspaceStore } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import {
  deleteOlderCopy,
  FAILURES_TO_SAY,
  nativeMoveFailures,
  olderCopy,
  olderCopyAccount,
  olderCopyKept,
} from '../store/nativeMigration.ts';
import type { ImportOutcome } from '../store/workspaceStore.ts';
import { downloadWorkspace } from './exportFile.ts';
import { ExportDialog, ImportDialog } from './InterchangeDialogs.tsx';
import { PurgeSetting } from './PurgeSetting.tsx';
import { Section, SettingRow } from './settingsLayout.tsx';

/**
 * Settings > Your data (spec: local storage, export and import): download everything as one JSON
 * file, or bring one in. An import merges, so it never loses what is here. Other apps' files come
 * in and go out through their own dialogs (PL-063).
 */
export function DataSection() {
  const store = useWorkspaceStore();
  // Signed in: another account's file takes fresh ids, which the server accepts (1.0).
  const onServer = useSyncState((state) => state.account !== null);
  const accountId = useSyncState((state) => state.account?.id ?? null);
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<'import' | 'export' | null>(null);
  // The Android app that has tried, start after start, to move data out of the WebView (PL-070).
  const [notMoved] = useState(() => nativeMoveFailures() >= FAILURES_TO_SAY);
  // An older copy the Android app kept because it could not merge it (PL-070): one quiet row.
  const [older, setOlder] = useState(olderCopyKept);
  const [olderBusy, setOlderBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The older copy was signed in to another account than this one: asked first.
  const [confirmOther, setConfirmOther] = useState(false);

  const download = () => {
    const workspace = store.getState().workspace;
    if (workspace) downloadWorkspace(workspace);
  };

  const bringIn = async (file: File) => {
    setNotice(null);
    const parsed = parseJson(await file.text());
    if (!parsed.ok) {
      setNotice({ ok: false, text: t('settings.data.notJson') });
      return;
    }
    say(store.getState().importDocument(parsed.value, t('undo.imported'), { onServer }));
  };

  const say = (outcome: ImportOutcome) => {
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
          templates: outcome.templates,
        }),
      });
    }
  };

  // Through the import path, with no undo: the copy goes once what it has is saved here.
  const bringInOlder = async () => {
    setNotice(null);
    setOlderBusy(true);
    try {
      const copy = await olderCopy();
      if (!copy) {
        setOlder(!(await deleteOlderCopy()));
        return;
      }
      const outcome = store.getState().importDocument(copy);
      if (outcome.kind !== 'ok') {
        setNotice({ ok: false, text: t('settings.data.olderFailed') });
        return;
      }
      say(outcome);
      await store.getState().flush();
      setOlder(!(await deleteOlderCopy()));
    } catch (error) {
      console.warn('Could not bring in the older copy', error);
      setNotice({ ok: false, text: t('settings.data.olderFailed') });
    } finally {
      setOlderBusy(false);
    }
  };

  // A copy that synced with another account would add that account's tasks to this one: say so
  // first. One that never signed in is this phone's own, and comes in as it did.
  const askBringInOlder = async () => {
    // Busy from the first tap: a second one while the account is read starts nothing (Dev 2).
    setOlderBusy(true);
    let from: string | null = null;
    try {
      from = await olderCopyAccount();
    } catch (error) {
      console.warn('Could not read the older copy\u2019s account', error);
    }
    if (from !== null && from !== accountId) {
      setOlderBusy(false);
      setConfirmOther(true);
    } else void bringInOlder();
  };

  const deleteOlder = async () => {
    setConfirmDelete(false);
    setNotice(null);
    setOlderBusy(true);
    try {
      const gone = await deleteOlderCopy();
      setOlder(!gone);
      if (gone) setNotice({ ok: true, text: t('settings.data.olderDeleted') });
    } finally {
      setOlderBusy(false);
    }
  };

  return (
    <Section title={t('settings.data')} plain>
      {notMoved && (
        <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
          {t('settings.data.notMoved')}
        </Alert>
      )}
      {older && (
        <SettingRow label={t('settings.data.older')} hint={t('settings.data.olderHint')}>
          <Button variant="outlined" disabled={olderBusy} onClick={() => void askBringInOlder()}>
            {t('settings.data.olderBringIn')}
          </Button>
          <Button
            variant="outlined"
            color="error"
            disabled={olderBusy}
            onClick={() => setConfirmDelete(true)}
          >
            {t('settings.data.olderDelete')}
          </Button>
        </SettingRow>
      )}
      <SettingRow label={t('settings.data.download')} hint={t('settings.data.downloadHint')}>
        <Button variant="outlined" aria-label={t('settings.data.download')} onClick={download}>
          {t('settings.data.downloadAction')}
        </Button>
      </SettingRow>
      <SettingRow label={t('settings.data.import')} hint={t('settings.data.importHint')}>
        <Button
          variant="outlined"
          aria-label={t('settings.data.import')}
          onClick={() => input.current?.click()}
        >
          {t('settings.data.importAction')}
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
      </SettingRow>
      <SettingRow label={t('settings.data.fromApp')} hint={t('settings.data.fromAppHint')}>
        <Button
          variant="outlined"
          aria-label={t('settings.data.fromApp')}
          onClick={() => setOpen('import')}
        >
          {t('settings.data.importAction')}
        </Button>
      </SettingRow>
      <SettingRow label={t('settings.data.forApp')} hint={t('settings.data.forAppHint')}>
        <Button
          variant="outlined"
          aria-label={t('settings.data.forApp')}
          onClick={() => setOpen('export')}
        >
          {t('settings.data.exportAction')}
        </Button>
      </SettingRow>
      <PurgeSetting />
      {open === 'import' && (
        <ImportDialog
          onClose={() => setOpen(null)}
          onDone={(text) => setNotice({ ok: true, text })}
        />
      )}
      {open === 'export' && <ExportDialog onClose={() => setOpen(null)} />}
      <ConfirmDialog
        open={confirmDelete}
        message={t('settings.data.olderConfirm')}
        confirmLabel={t('settings.data.olderDelete')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void deleteOlder()}
      />
      <ConfirmDialog
        open={confirmOther}
        message={t('settings.data.olderOtherAccount')}
        confirmLabel={t('settings.data.olderBringIn')}
        onClose={() => setConfirmOther(false)}
        onConfirm={() => {
          setConfirmOther(false);
          void bringInOlder();
        }}
      />
      {notice && (
        <Alert
          severity={notice.ok ? 'success' : 'error'}
          variant="outlined"
          sx={{ mt: 1 }}
          onClose={() => setNotice(null)}
        >
          {notice.text}
        </Alert>
      )}
    </Section>
  );
}
