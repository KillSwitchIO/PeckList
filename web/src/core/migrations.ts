// Schema versions and migrations. `schemaVersion` is an integer; every schema change bumps
// it and registers a migration from N-1 to N, with fixtures in schema/fixtures/migrations.

import { keyBetween } from './ordering.ts';

export const CURRENT_SCHEMA_VERSION = 12;

export type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

/** Migration registry: key N migrates a version N-1 document to version N. */
export type MigrationRegistry = Readonly<Record<number, Migration>>;

export const MIGRATIONS: MigrationRegistry = {
  // 2: tasks gain `progress` (percent done, 0 = none).
  2: (document) => {
    const entities = document.entities as Record<string, unknown[]> | undefined;
    if (!entities || !Array.isArray(entities.tasks)) return document;
    return {
      ...document,
      entities: {
        ...entities,
        tasks: entities.tasks.map((task) => ({ ...(task as object), progress: 0 })),
      },
    };
  },
  // 3: settings gain the sidebar layout (the default one).
  3: (document) => {
    const entities = document.entities as Record<string, unknown[]> | undefined;
    if (!entities || !Array.isArray(entities.settings)) return document;
    return {
      ...document,
      entities: {
        ...entities,
        settings: entities.settings.map((settings) => ({
          ...(settings as object),
          sidebar: {
            order: [
              'today',
              'inbox',
              'upcoming',
              'all',
              'calendar',
              '@group',
              'completed',
              'trash',
            ],
            hidden: [],
            groupOpen: false,
          },
        })),
      },
    };
  },
  // 4: tags gain an order; they keep the alphabetical order (by path) they had.
  4: (document) => {
    const entities = document.entities as Record<string, unknown[]> | undefined;
    if (!entities || !Array.isArray(entities.tags)) return document;
    const tags = entities.tags as { name: string }[];
    const segments = (name: string) => name.toLowerCase().split('/');
    const byPath = [...tags].sort((a, b) => {
      const left = segments(a.name);
      const right = segments(b.name);
      for (let i = 0; i < Math.min(left.length, right.length); i++) {
        const order = left[i]!.localeCompare(right[i]!);
        if (order !== 0) return order;
      }
      return left.length - right.length;
    });
    const orders = new Map<object, string>();
    let previous: string | null = null;
    for (const tag of byPath) {
      previous = keyBetween(previous, null);
      orders.set(tag, previous);
    }
    return {
      ...document,
      entities: { ...entities, tags: tags.map((tag) => ({ ...tag, order: orders.get(tag) })) },
    };
  },
  // 5: settings may hold clockFormat and weekStart. Both are optional (a missing one means the
  // default: 12-hour clock, Sunday), so documents change only in version; older apps must not
  // open version 5 files, which may carry them.
  5: (document) => document,
  // 6: friendships may hold madeBy (the admin who made it, with their name). Optional, so
  // documents change only in version.
  6: (document) => document,
  // 7: comments on tasks, a new collection (empty to start with).
  7: (document) => {
    const entities = document.entities as Record<string, unknown[]> | undefined;
    if (!entities) return document;
    return { ...document, entities: { ...entities, comments: entities.comments ?? [] } };
  },
  // 8: files on tasks, a new collection (empty to start with).
  8: (document) => {
    const entities = document.entities as Record<string, unknown[]> | undefined;
    if (!entities) return document;
    return { ...document, entities: { ...entities, attachments: entities.attachments ?? [] } };
  },
  // 9: settings may hold bottomBar (the phone's tabs), and lists ownerId (set when an admin hands
  // a list over). Both optional (missing: the default tabs, the creator), so documents change only
  // in version.
  9: (document) => document,
  // 10: settings may hold newTask (what a new task starts with). Optional (missing: the old
  // behavior), so documents change only in version.
  10: (document) => document,
  // 11: settings may name a palette preset (palettePreset). Optional (missing: the Punchlist
  // colors), so documents change only in version.
  11: (document) => document,
  // 12: tasks may hold reminders, and new task defaults a reminder default. Optional (missing:
  // none), so documents change only in version.
  12: (document) => document,
};

export type VersionCheck =
  | { kind: 'open'; version: number }
  | { kind: 'upgrade'; from: number; to: number }
  | { kind: 'refuse'; fileVersion: number; supported: number }
  | { kind: 'invalid'; reason: string };

export function readSchemaVersion(document: unknown): number | null {
  if (typeof document !== 'object' || document === null) return null;
  const version = (document as Record<string, unknown>).schemaVersion;
  return Number.isInteger(version) && (version as number) >= 1 ? (version as number) : null;
}

export function checkVersion(document: unknown, supported = CURRENT_SCHEMA_VERSION): VersionCheck {
  const version = readSchemaVersion(document);
  if (version === null) return { kind: 'invalid', reason: 'missing or malformed schemaVersion' };
  if (version === supported) return { kind: 'open', version };
  if (version < supported) return { kind: 'upgrade', from: version, to: supported };
  return { kind: 'refuse', fileVersion: version, supported };
}

/** Upgrade a document step by step to `target`. The input is not modified. */
export function migrate(
  document: Record<string, unknown>,
  target = CURRENT_SCHEMA_VERSION,
  registry: MigrationRegistry = MIGRATIONS,
): Record<string, unknown> {
  const start = readSchemaVersion(document);
  if (start === null) throw new Error('missing or malformed schemaVersion');
  if (start > target) throw new Error(`cannot downgrade schema ${start} to ${target}`);
  let version: number = start;
  let current = structuredClone(document);
  while (version < target) {
    const next: number = version + 1;
    const step = registry[next];
    if (!step) throw new Error(`no migration registered for schema ${version} to ${next}`);
    current = { ...step(current), schemaVersion: next };
    version = next;
  }
  return current;
}

/** Name for the backup written before an upgrade, e.g. `workspace.v1.bak.json`. */
export function backupName(baseName: string, version: number): string {
  const stem = baseName.replace(/\.json$/i, '');
  return `${stem}.v${version}.bak.json`;
}
