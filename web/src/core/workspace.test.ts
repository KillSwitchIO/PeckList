import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { sampleWorkspace, testContext } from '../test/fixtures.ts';
import { CURRENT_SCHEMA_VERSION } from './migrations.ts';
import { createWorkspace, emptyEntities, serializeWorkspace } from './workspace.ts';
import { COLLECTIONS } from './types.ts';

describe('createWorkspace', () => {
  it('creates the owner, an Inbox and settings', () => {
    const ctx = testContext();
    const workspace = createWorkspace(ctx, { displayName: 'Ben' });
    expect(workspace.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(workspace.owner).toBe(ctx.userId);
    expect(workspace.entities.users[0]?.displayName).toBe('Ben');
    expect(workspace.entities.lists[0]?.isInbox).toBe(true);
    expect(workspace.entities.settings[0]?.themeMode).toBe('system');
  });

  it('validates against the JSON Schema', () => {
    const validator = createAjvValidator();
    const result = validator.validate(sampleWorkspace());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('has every collection', () => {
    expect(Object.keys(emptyEntities()).sort()).toEqual([...COLLECTIONS].sort());
  });
});

describe('serializeWorkspace', () => {
  it('is stable, pretty and newline-terminated', () => {
    const workspace = sampleWorkspace();
    const text = serializeWorkspace(workspace);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toBe(serializeWorkspace(JSON.parse(text)));
  });
});
