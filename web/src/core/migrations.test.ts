import { describe, expect, it } from 'vitest';
import {
  backupName,
  checkVersion,
  CURRENT_SCHEMA_VERSION,
  migrate,
  readSchemaVersion,
  type MigrationRegistry,
} from './migrations.ts';

const registry: MigrationRegistry = {
  2: (doc) => ({ ...doc, addedInTwo: true }),
  3: (doc) => ({ ...doc, renamed: doc.addedInTwo, addedInTwo: undefined }),
};

describe('checkVersion', () => {
  it('opens the current version', () => {
    expect(checkVersion({ schemaVersion: CURRENT_SCHEMA_VERSION })).toEqual({
      kind: 'open',
      version: CURRENT_SCHEMA_VERSION,
    });
  });

  it('asks to upgrade older files', () => {
    expect(checkVersion({ schemaVersion: 1 }, 3)).toEqual({ kind: 'upgrade', from: 1, to: 3 });
  });

  it('refuses newer files', () => {
    expect(checkVersion({ schemaVersion: 9 }, 3)).toEqual({
      kind: 'refuse',
      fileVersion: 9,
      supported: 3,
    });
  });

  it('flags malformed documents', () => {
    expect(checkVersion(null).kind).toBe('invalid');
    expect(checkVersion({ schemaVersion: '1' }).kind).toBe('invalid');
    expect(checkVersion({ schemaVersion: 0 }).kind).toBe('invalid');
    expect(readSchemaVersion([])).toBeNull();
  });
});

describe('migrate', () => {
  it('applies every step in order without touching the input', () => {
    const input = { schemaVersion: 1, data: 'x' };
    const output = migrate(input, 3, registry);
    expect(output).toEqual({ schemaVersion: 3, data: 'x', renamed: true, addedInTwo: undefined });
    expect(input).toEqual({ schemaVersion: 1, data: 'x' });
  });

  it('is a no-op at the target version', () => {
    expect(migrate({ schemaVersion: 3 }, 3, registry)).toEqual({ schemaVersion: 3 });
  });

  it('fails on missing steps, downgrades and bad versions', () => {
    expect(() => migrate({ schemaVersion: 1 }, 4, registry)).toThrow(
      'no migration registered for schema 3 to 4',
    );
    expect(() => migrate({ schemaVersion: 5 }, 3, registry)).toThrow('cannot downgrade');
    expect(() => migrate({}, 3, registry)).toThrow('malformed');
  });
});

describe('backupName', () => {
  it('names backups by version', () => {
    expect(backupName('workspace.json', 1)).toBe('workspace.v1.bak.json');
    expect(backupName('punchlist', 2)).toBe('punchlist.v2.bak.json');
  });
});
