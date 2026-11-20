import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { testContext } from '../test/fixtures.ts';
import { rowDensityOf, setRowDensity, updateSettings } from './settings.ts';
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

  it('a view shows compact rows once picked, others keep theirs, and it is part of the file format (schema 19)', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    expect(rowDensityOf(ws, 'view:today')).toBe('comfortable');
    // Already so: nothing changes.
    expect(setRowDensity(ctx, ws, 'view:today', 'comfortable')).toBe(ws);
    const both = setRowDensity(
      ctx,
      setRowDensity(ctx, ws, 'view:upcoming', 'compact'),
      'view:today',
      'compact',
    );
    expect(both.entities.settings[0]?.compactViews).toEqual(['view:upcoming', 'view:today']);
    expect(rowDensityOf(both, 'view:today')).toBe('compact');
    expect(createAjvValidator().validate(both).errors).toEqual([]);
    const back = setRowDensity(ctx, both, 'view:today', 'comfortable');
    expect(back.entities.settings[0]?.compactViews).toEqual(['view:upcoming']);
    expect(rowDensityOf(back, 'view:today')).toBe('comfortable');
  });
});
