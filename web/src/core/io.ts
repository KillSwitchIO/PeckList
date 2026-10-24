// Opening a workspace document from any source: version check, migration, validation.

import type { SchemaValidator } from '../ports/validator.ts';
import {
  checkVersion,
  migrate,
  type MigrationRegistry,
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
} from './migrations.ts';
import { joinAccount, type SyncChange } from './sync.ts';
import { COLLECTIONS, type WorkspaceFile } from './types.ts';

export type OpenResult =
  | { kind: 'ok'; workspace: WorkspaceFile }
  /** The document is older: the caller must ask for consent, back it up, then call upgrade. */
  | { kind: 'needs-upgrade'; from: number; to: number; document: Record<string, unknown> }
  /** The document is newer than this app: refuse and offer an app update. */
  | { kind: 'needs-app-update'; fileVersion: number; supported: number }
  | { kind: 'invalid'; errors: string[] };

export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function openDocument(
  document: unknown,
  validator: SchemaValidator,
  supported = CURRENT_SCHEMA_VERSION,
): OpenResult {
  const check = checkVersion(document, supported);
  switch (check.kind) {
    case 'invalid':
      return { kind: 'invalid', errors: [check.reason] };
    case 'refuse':
      return {
        kind: 'needs-app-update',
        fileVersion: check.fileVersion,
        supported: check.supported,
      };
    case 'upgrade':
      return {
        kind: 'needs-upgrade',
        from: check.from,
        to: check.to,
        document: document as Record<string, unknown>,
      };
    case 'open': {
      const result = validator.validate(document);
      return result.valid
        ? { kind: 'ok', workspace: document as WorkspaceFile }
        : { kind: 'invalid', errors: result.errors };
    }
  }
}

/** Run migrations on an older document, then validate the result. */
export function upgradeDocument(
  document: Record<string, unknown>,
  validator: SchemaValidator,
  target = CURRENT_SCHEMA_VERSION,
  registry: MigrationRegistry = MIGRATIONS,
): OpenResult {
  let upgraded: Record<string, unknown>;
  try {
    upgraded = migrate(document, target, registry);
  } catch (error) {
    return { kind: 'invalid', errors: [error instanceof Error ? error.message : String(error)] };
  }
  return openDocument(upgraded, validator, target);
}

/**
 * An exported file brought into this device's data. Same-id entities merge field by field (the
 * newer edit wins, so nothing here is overwritten by an older copy). A file from another person or
 * device becomes this owner's: its own Mess Drawer, settings and profile give way to this one's,
 * and the Mess Drawer's tasks move into this one's.
 */
export function importWorkspace(current: WorkspaceFile, incoming: WorkspaceFile): WorkspaceFile {
  const here: SyncChange[] = COLLECTIONS.flatMap((collection) =>
    current.entities[collection].map((entity) => ({ collection, entity })),
  );
  const joined = joinAccount(incoming, current.owner, here);
  return { ...current, entities: joined.entities };
}

/** How many live entities of each kind `after` has that `before` did not. */
export function importCounts(
  before: WorkspaceFile,
  after: WorkspaceFile,
): { tasks: number; lists: number; tags: number } {
  const added = (collection: 'tasks' | 'lists' | 'tags') => {
    const known = new Set(before.entities[collection].map((entity) => entity.id));
    return after.entities[collection].filter(
      (entity) => !known.has(entity.id) && entity.deletedAt === null,
    ).length;
  };
  return { tasks: added('tasks'), lists: added('lists'), tags: added('tags') };
}
