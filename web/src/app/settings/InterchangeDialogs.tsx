import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useRef, useState } from 'react';
import type { DateParser } from '../../ports/dateParser.ts';
import { localTimeZone } from '../../core/dates.ts';
import { visibleLists } from '../../core/lists.ts';
import {
  applyImport,
  planSummary,
  replaceable,
  type ImportOutcome,
} from '../../core/interchange/apply.ts';
import { dateReader } from '../../core/interchange/dateText.ts';
import {
  accepts,
  detectSource,
  EXPORT_TARGETS,
  exportFor,
  IMPORT_SOURCES,
  ImportError,
  readPlan,
  type ExportTarget,
  type ImportSource,
} from '../../core/interchange/index.ts';
import type { ImportNote, ImportPlan } from '../../core/interchange/model.ts';
import { thingsUrl } from '../../core/interchange/things.ts';
import { writeZip } from '../../core/interchange/zip.ts';
import { t, type MessageKey } from '../i18n/i18n.ts';
import { useWorkspaceStore } from '../store/hooks.ts';

// The date parser loads on first use (Todoist's dates are words).
let parserPromise: Promise<DateParser> | null = null;
function loadParser(): Promise<DateParser> {
  parserPromise ??= import('../../adapters/chrono-date-parser.ts').then((module) =>
    module.createChronoDateParser(),
  );
  return parserPromise;
}

const appName = (app: ImportSource | ExportTarget) => t(`interchange.app.${app}` as MessageKey);

/** Several files at once, for apps whose export is a file a list. */
const MANY: ReadonlySet<ImportSource> = new Set(['todoist', 'ical', 'googleTasks']);

/** A file the browser downloads. */
function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Settings > Your data > Import from another app (spec: PL-063): the app, its file(s), what
 * they hold, and whether to merge with what is here or replace it. One change, so one undo.
 */
export function ImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const store = useWorkspaceStore();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>('ticktick');
  const [names, setNames] = useState<string[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [intoSameNamed, setIntoSameNamed] = useState(true);
  const summary = useMemo(() => (plan ? planSummary(plan) : null), [plan]);
  const workspace = store.getState().workspace;
  const doomed = useMemo(() => {
    if (!workspace) return null;
    const found = replaceable(workspace, store.getState().context().userId);
    return { lists: found.lists.length, tasks: found.tasks.length, tags: found.tags.length };
  }, [workspace, store]);

  const choose = (next: ImportSource) => {
    setSource(next);
    setPlan(null);
    setNames([]);
    setProblem(null);
  };

  const read = async (files: File[]) => {
    setBusy(true);
    setPlan(null);
    setProblem(null);
    setNames(files.map((file) => file.name));
    let used = source;
    try {
      const ws = store.getState().workspace!;
      const timeZone = localTimeZone();
      const parser = await loadParser();
      const bytes = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      // The file says which app it came from; that wins over the picker.
      const found = (await detectSource(bytes)) ?? source;
      if (found !== source) setSource(found);
      used = found;
      setPlan(
        await readPlan(found, bytes, {
          timeZone,
          readDate: dateReader({ workspace: ws, parser, reference: new Date(), timeZone }),
        }),
      );
    } catch (error) {
      const code = error instanceof ImportError ? error.code : 'unreadable';
      setProblem(t(`interchange.import.${code}`, { app: appName(used) }));
    } finally {
      setBusy(false);
    }
  };

  const bringIn = () => {
    if (!plan) return;
    let outcome: ImportOutcome | null = null;
    store.getState().apply(
      (ctx, ws) => {
        outcome = applyImport(ctx, ws, plan, { mode, intoSameNamed });
        return outcome.workspace;
      },
      t('undo.importedFrom', { app: appName(source) }),
    );
    const done = outcome as ImportOutcome | null;
    if (done) {
      onDone(
        t(mode === 'replace' ? 'interchange.import.doneReplaced' : 'interchange.import.done', {
          app: appName(source),
          tasks: done.tasks,
          lists: done.lists,
          tags: done.tags,
        }),
      );
    }
    onClose();
  };

  const notes = summary
    ? (Object.entries(summary.notes) as [ImportNote, number][]).filter(([, count]) => count > 0)
    : [];

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('interchange.import.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label={t('interchange.import.app')}
            value={source}
            onChange={(event) => choose(event.target.value as ImportSource)}
            size="small"
          >
            {IMPORT_SOURCES.map((each) => (
              <MenuItem key={each} value={each}>
                {appName(each)}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t(`interchange.import.how.${source}` as MessageKey)}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Button variant="outlined" disabled={busy} onClick={() => input.current?.click()}>
              {t(MANY.has(source) ? 'interchange.import.chooseMore' : 'interchange.import.choose')}
            </Button>
            <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 0 }} noWrap>
              {busy ? t('interchange.import.reading') : names.join(', ')}
            </Typography>
            <input
              ref={input}
              type="file"
              hidden
              multiple={MANY.has(source)}
              accept={accepts(source)}
              aria-label={t('interchange.import.choose')}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                if (files.length) void read(files);
              }}
            />
          </Box>
          {problem && (
            <Alert severity="error" variant="outlined">
              {problem}
            </Alert>
          )}
          {summary && (
            <Box data-testid="import-preview">
              <Typography>
                {t('interchange.import.found', {
                  lists: summary.lists,
                  open: summary.open,
                  closed: summary.closed,
                  tags: summary.tags,
                })}
              </Typography>
              {notes.map(([what, count]) => (
                <Typography key={what} variant="body2" sx={{ color: 'text.secondary' }}>
                  {t(`interchange.note.${what}` as MessageKey, { count })}
                </Typography>
              ))}
            </Box>
          )}
          {summary && (
            <RadioGroup
              value={mode}
              onChange={(event) => setMode(event.target.value as 'merge' | 'replace')}
            >
              <FormControlLabel
                value="merge"
                control={<Radio />}
                label={
                  <Box>
                    <Typography>{t('interchange.import.merge')}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {t('interchange.import.mergeHint')}
                    </Typography>
                  </Box>
                }
              />
              {mode === 'merge' && (
                <FormControlLabel
                  sx={{ ml: 3.5 }}
                  control={
                    <Checkbox
                      checked={intoSameNamed}
                      onChange={(event) => setIntoSameNamed(event.target.checked)}
                    />
                  }
                  label={t('interchange.import.sameNamed')}
                />
              )}
              <FormControlLabel
                value="replace"
                control={<Radio />}
                sx={{ mt: 1 }}
                label={
                  <Box>
                    <Typography>{t('interchange.import.replace')}</Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: mode === 'replace' ? 'warning.main' : 'text.secondary' }}
                    >
                      {t(
                        'interchange.import.replaceHint',
                        doomed ?? { lists: 0, tasks: 0, tags: 0 },
                      )}
                    </Typography>
                  </Box>
                }
              />
            </RadioGroup>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color={mode === 'replace' ? 'warning' : 'primary'}
          disabled={!plan || busy}
          onClick={bringIn}
        >
          {t('interchange.import.go')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Settings > Your data > Export for another app (spec: PL-063): the app and which lists, then a
 * file (a zip when it is one a list and there are several), or Things' links.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const store = useWorkspaceStore();
  const workspace = store.getState().workspace;
  const [target, setTarget] = useState<ExportTarget>('ticktick');
  const [scope, setScope] = useState<string>('all');
  const [problem, setProblem] = useState<string | null>(null);
  const lists = useMemo(() => (workspace ? visibleLists(workspace) : []), [workspace]);
  const listIds = scope === 'all' ? null : [scope];
  const things = useMemo(
    () => (target === 'things' && workspace ? exportFor('things', workspace, listIds) : null),
    // listIds follows scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, workspace, scope],
  );

  const download = () => {
    if (!workspace) return;
    const result = exportFor(target, workspace, listIds);
    if (result.kind !== 'files') return;
    if (!result.files.length) {
      setProblem(t('interchange.export.nothing'));
      return;
    }
    if (result.files.length === 1) {
      const file = result.files[0]!;
      // A byte-order mark, so Excel and Outlook read the CSV as UTF-8.
      save(file.name, `${file.name.endsWith('.csv') ? '﻿' : ''}${file.text}`, result.type);
    } else {
      const stamp = new Date().toISOString().slice(0, 10);
      save(
        `punchlist-${target}-${stamp}.zip`,
        writeZip(result.files) as Uint8Array<ArrayBuffer>,
        'application/zip',
      );
    }
    onClose();
  };

  const batches = things?.kind === 'things' ? things.things : null;
  const hasProjects = batches?.batches[0]?.[0]?.type === 'project';
  const todoBatches = batches ? batches.batches.length - (hasProjects ? 1 : 0) : 0;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('interchange.export.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label={t('interchange.export.app')}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value as ExportTarget);
              setProblem(null);
            }}
            size="small"
          >
            {EXPORT_TARGETS.map((each) => (
              <MenuItem key={each} value={each}>
                {appName(each)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('interchange.export.scope')}
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setProblem(null);
            }}
            size="small"
          >
            <MenuItem value="all">{t('interchange.export.all')}</MenuItem>
            {lists.map((list) => (
              <MenuItem key={list.id} value={list.id}>
                {list.isInbox ? t('nav.inbox') : list.name}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t(`interchange.export.how.${target}` as MessageKey)}
          </Typography>
          {problem && (
            <Alert severity="info" variant="outlined">
              {problem}
            </Alert>
          )}
          {batches && !batches.batches.length && (
            <Alert severity="info" variant="outlined">
              {t('interchange.export.nothing')}
            </Alert>
          )}
          {batches && batches.batches.length > 0 && (
            <Stack spacing={1} data-testid="things-links">
              {batches.batches.map((batch, index) => {
                const isProjects = hasProjects && index === 0;
                const n = index + (hasProjects ? 0 : 1);
                return (
                  <Button key={index} variant="outlined" href={thingsUrl(batch)}>
                    {isProjects
                      ? t('interchange.export.projects')
                      : t('interchange.export.batch', { n, total: todoBatches })}
                  </Button>
                );
              })}
              {(batches.repeatsDropped > 0 || batches.prioritiesDropped > 0) && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('interchange.export.thingsDropped', {
                    repeats: batches.repeatsDropped,
                    priorities: batches.prioritiesDropped,
                  })}
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        {target !== 'things' && (
          <Button variant="contained" onClick={download}>
            {t('interchange.export.go')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
