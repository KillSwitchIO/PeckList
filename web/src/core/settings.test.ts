import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { testContext } from '../test/fixtures.ts';
import { updateSettings } from './settings.ts';
import { createWorkspace } from './workspace.ts';

describe('settings', () => {
  it('changes only what differs', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    expect(updateSettings(ctx, ws, { themeMode: 'system', dueSoonDays: 2 })).toBe(ws);
    const next = updateSettings(ctx, ws, { themeMode: 'dark', dueSoonDays: 5 });
    expect(next.entities.settings[0]).toMatchObject({ themeMode: 'dark', dueSoonDays: 5 });
  });

  it('clock and week start are part of the file format (schema 5)', () => {
    const ctx = testContext();
    const ws = updateSettings(ctx, createWorkspace(ctx), { clockFormat: '24h', weekStart: 1 });
    expect(createAjvValidator().validate(ws).errors).toEqual([]);
  });
});
