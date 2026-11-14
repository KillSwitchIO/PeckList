// Other apps' files in and out (spec: PL-063): what each app gives and takes, zips unpacked, text
// decoded, and the right reader or writer for each.

import type { WorkspaceFile } from '../types.ts';
import type { DateReader } from './dateText.ts';
import { exportIcal, parseIcal } from './ical.ts';
import { parseGoogleTasks } from './googleTasks.ts';
import { emptyPlan, type ImportPlan, type InterchangeSource } from './model.ts';
import { exportOutlook, parseOutlook } from './outlook.ts';
import { exportThings, type ThingsExport } from './things.ts';
import { exportTickTick, parseTickTick } from './ticktick.ts';
import { exportTodoist, parseTodoist } from './todoist.ts';
import { parseCsv } from './csv.ts';
import { isZip, readZip } from './zip.ts';

export type ImportSource = Exclude<InterchangeSource, 'things'>;
export type ExportTarget = Exclude<InterchangeSource, 'googleTasks'>;

export const IMPORT_SOURCES: readonly ImportSource[] = [
  'ticktick',
  'todoist',
  'googleTasks',
  'microsoftToDo',
  'ical',
];
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  'ticktick',
  'todoist',
  'microsoftToDo',
  'ical',
  'things',
];

/** The files each source's export comes as (a zip of them is fine too). */
const EXTENSIONS: Record<ImportSource, RegExp> = {
  ticktick: /\.csv$/i,
  todoist: /\.csv$/i,
  googleTasks: /\.json$/i,
  microsoftToDo: /\.csv$/i,
  ical: /\.(ics|ical|ifb|icalendar)$/i,
};

/** What a file picker should offer for a source. */
export const accepts = (source: ImportSource) =>
  ({
    ticktick: '.csv,text/csv',
    todoist: '.csv,.zip,text/csv,application/zip',
    googleTasks: '.json,.zip,application/json,application/zip',
    microsoftToDo: '.csv,text/csv',
    ical: '.ics,.zip,text/calendar,application/zip',
  })[source];

export class ImportError extends Error {
  constructor(readonly code: 'noFiles' | 'unreadable' | 'empty') {
    super(code);
  }
}

/** Text from bytes: UTF-8, else Windows-1252 (as Outlook writes it). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The files, zips unpacked, that a source reads, as text. */
async function textFiles(
  source: ImportSource,
  files: readonly { name: string; bytes: Uint8Array }[],
): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for (const file of files) {
    const entries = isZip(file.bytes) ? await readZip(file.bytes) : [file];
    for (const entry of entries) {
      // Takeout holds every Google product: only its Tasks.
      if (source === 'googleTasks' && isZip(file.bytes) && !/(^|\/)Tasks\//i.test(entry.name)) {
        continue;
      }
      if (EXTENSIONS[source].test(entry.name) || !isZip(file.bytes)) {
        out.push({ name: entry.name, text: decodeText(entry.bytes) });
      }
    }
  }
  if (!out.length) throw new ImportError('noFiles');
  return out;
}

/** Which app's export a text looks like, or null. */
function looksLike(name: string, text: string): ImportSource | null {
  const start = text.replace(/^\uFEFF/, '').trimStart();
  if (/^BEGIN:VCALENDAR/i.test(start)) return /BEGIN:VTODO/i.test(text) ? 'ical' : null;
  if (/\.json$/i.test(name) || start.startsWith('{') || start.startsWith('[')) {
    return /"tasks#task(List)?s?"|"kind"\s*:\s*"tasks#/.test(text) ? 'googleTasks' : null;
  }
  const rows = parseCsv(start.slice(0, 20_000));
  for (const row of rows.slice(0, 12)) {
    const cells = row.map((cell) => cell.trim());
    if (cells[0] === 'Folder Name' && cells.includes('List Name')) return 'ticktick';
    if (cells[0] === 'TYPE' && cells.includes('CONTENT')) return 'todoist';
    if (cells.includes('Subject') && cells.includes('Due Date')) return 'microsoftToDo';
  }
  return null;
}

/** The app whose export these files are (zips looked into), or null when none fits. */
export async function detectSource(
  files: readonly { name: string; bytes: Uint8Array }[],
): Promise<ImportSource | null> {
  for (const file of files) {
    const entries = isZip(file.bytes) ? await readZip(file.bytes) : [file];
    for (const entry of entries) {
      if (/(^|\/)(__MACOSX|\.)/.test(entry.name)) continue;
      const found = looksLike(entry.name, decodeText(entry.bytes.subarray(0, 200_000)));
      if (found) return found;
    }
  }
  return null;
}

export interface ReadOptions {
  timeZone: string;
  /** For Todoist's dates as words */
  readDate: DateReader;
}

/** An app's export files as one import plan. */
export async function readPlan(
  source: ImportSource,
  files: readonly { name: string; bytes: Uint8Array }[],
  options: ReadOptions,
): Promise<ImportPlan> {
  const texts = await textFiles(source, files);
  let plan: ImportPlan;
  try {
    plan = (() => {
      switch (source) {
        case 'ticktick':
          return merged(
            source,
            texts.map((each) => parseTickTick(each.text, options)),
          );
        case 'todoist':
          return parseTodoist(texts, options);
        case 'googleTasks':
          return merged(
            source,
            texts.map((each) => parseGoogleTasks(each.text, options)),
          );
        case 'microsoftToDo':
          return merged(
            source,
            texts.map((each) => parseOutlook(each, options)),
          );
        case 'ical':
          return parseIcal(texts, options);
      }
    })();
  } catch {
    throw new ImportError('unreadable');
  }
  if (!plan.tasks.length) throw new ImportError('empty');
  return plan;
}

/** Plans from several files as one; their keys kept apart. */
function merged(source: ImportSource, plans: ImportPlan[]): ImportPlan {
  if (plans.length === 1) return plans[0]!;
  const out = emptyPlan(source);
  plans.forEach((plan, index) => {
    const key = (value: string) => `${index}:${value}`;
    out.lists.push(...plan.lists.map((list) => ({ ...list, key: key(list.key) })));
    out.tasks.push(
      ...plan.tasks.map((task) => ({
        ...task,
        key: key(task.key),
        listKey: key(task.listKey),
        parentKey: task.parentKey ? key(task.parentKey) : null,
      })),
    );
    if (plan.guessedStarts?.length) {
      (out.guessedStarts ??= []).push(...plan.guessedStarts.map(key));
    }
    for (const [what, count] of Object.entries(plan.notes)) {
      out.notes[what as keyof ImportPlan['notes']] =
        (out.notes[what as keyof ImportPlan['notes']] ?? 0) + (count ?? 0);
    }
  });
  return out;
}

export type ExportResult =
  | { kind: 'files'; files: { name: string; text: string }[]; type: string }
  | { kind: 'things'; things: ThingsExport };

/** The lists (all, or those named) as files for another app (or Things' batches). */
export function exportFor(
  target: ExportTarget,
  workspace: WorkspaceFile,
  listIds: readonly string[] | null,
  now = new Date(),
): ExportResult {
  const stamp = now.toISOString().slice(0, 10);
  switch (target) {
    case 'ticktick':
      return {
        kind: 'files',
        type: 'text/csv',
        files: [
          {
            name: `TickTick-backup-${stamp}.csv`,
            text: exportTickTick(workspace, { listIds, now }),
          },
        ],
      };
    case 'todoist':
      return { kind: 'files', type: 'text/csv', files: exportTodoist(workspace, listIds) };
    case 'microsoftToDo':
      return { kind: 'files', type: 'text/csv', files: exportOutlook(workspace, listIds) };
    case 'ical':
      return {
        kind: 'files',
        type: 'text/calendar',
        files: exportIcal(workspace, listIds, { now }),
      };
    case 'things':
      return { kind: 'things', things: exportThings(workspace, listIds) };
  }
}
