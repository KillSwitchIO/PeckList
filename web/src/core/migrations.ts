// Schema versions and migrations. `schemaVersion` is an integer; every schema change bumps
// it and registers a migration from N-1 to N, with fixtures in schema/fixtures/migrations.

export const CURRENT_SCHEMA_VERSION = 1;

export type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

/** Migration registry: key N migrates a version N-1 document to version N. */
export type MigrationRegistry = Readonly<Record<number, Migration>>;

export const MIGRATIONS: MigrationRegistry = {};

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
