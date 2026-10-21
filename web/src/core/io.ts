// Opening a workspace document from any source: version check, migration, validation.

import type { SchemaValidator } from '../ports/validator.ts';
import {
  checkVersion,
  migrate,
  type MigrationRegistry,
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
} from './migrations.ts';
import type { WorkspaceFile } from './types.ts';

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
