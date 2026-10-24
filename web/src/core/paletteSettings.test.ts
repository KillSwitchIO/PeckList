import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { buildPalette, PALETTE_DEFAULTS } from './palette.ts';
import {
  PALETTE_SLOTS,
  paletteColor,
  paletteOverrides,
  resetPalette,
  setPaletteColor,
  tooFaint,
} from './paletteSettings.ts';
import { createWorkspace } from './workspace.ts';

describe('palette settings', () => {
  it('keeps only changed slots, and resets to the defaults', () => {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    expect(paletteColor(ws, 'accent')).toBe(PALETTE_DEFAULTS.accent);
    ws = setPaletteColor(ctx, ws, 'accent', '#7a5cc4');
    ws = setPaletteColor(ctx, ws, 'late', PALETTE_DEFAULTS.late);
    expect(paletteOverrides(ws)).toEqual({ accent: '#7A5CC4' });
    // A bad value changes nothing.
    expect(setPaletteColor(ctx, ws, 'slipped', 'orange')).toBe(ws);
    // The theme takes it.
    expect(buildPalette('light', paletteOverrides(ws)).accent.fill).not.toBe(
      buildPalette('light').accent.fill,
    );
    ws = setPaletteColor(ctx, ws, 'accent', null);
    expect(paletteOverrides(ws)).toEqual({});
    ws = setPaletteColor(ctx, ws, 'priorityHigh', '#C0392B');
    ws = resetPalette(ctx, ws);
    expect(paletteOverrides(ws)).toEqual({});
    expect(resetPalette(ctx, ws)).toBe(ws);
  });

  it('flags picks too faint to show as themselves, never the defaults', () => {
    for (const { slot } of PALETTE_SLOTS)
      expect(tooFaint(slot, PALETTE_DEFAULTS[slot])).toBe(false);
    expect(tooFaint('priorityHigh', '#F7F3D0')).toBe(true);
    expect(tooFaint('late', '#F3E1A0')).toBe(true);
    // Fills sit behind text that adapts to them: no warning.
    expect(tooFaint('accentContainer', '#FFFFFF')).toBe(false);
  });
});
