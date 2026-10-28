import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { buildPalette, PALETTE_DEFAULTS, PALETTE_PRESETS } from './palette.ts';
import {
  effectivePalette,
  PALETTE_SLOTS,
  paletteColor,
  paletteOverrides,
  palettePreset,
  resetPalette,
  setPaletteColor,
  setPalettePreset,
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

describe('palette presets', () => {
  it('start the colors from a named palette, with changes on top and reset back to it', () => {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    expect(palettePreset(ws)).toBe('punchlist');
    ws = setPalettePreset(ctx, ws, 'ocean');
    expect(paletteColor(ws, 'accent')).toBe(PALETTE_PRESETS.ocean.accent);
    // The theme draws with the preset where it differs from the defaults.
    expect(effectivePalette(ws).accent).toBe(PALETTE_PRESETS.ocean.accent);
    expect(effectivePalette(ws).priorityNone).toBeUndefined();

    ws = setPaletteColor(ctx, ws, 'late', '#C0392B');
    // Picking the preset's own color is no change.
    ws = setPaletteColor(ctx, ws, 'accent', PALETTE_PRESETS.ocean.accent);
    expect(paletteOverrides(ws)).toEqual({ late: '#C0392B' });
    expect(effectivePalette(ws).late).toBe('#C0392B');

    ws = resetPalette(ctx, ws);
    expect(palettePreset(ws)).toBe('ocean');
    expect(paletteColor(ws, 'late')).toBe(PALETTE_PRESETS.ocean.late);
  });

  it('drops changes when another preset is picked, and ignores unknown names', () => {
    const ctx = testContext();
    let ws = setPaletteColor(
      ctx,
      setPalettePreset(ctx, createWorkspace(ctx), 'forest'),
      'accent',
      '#123456',
    );
    ws = setPalettePreset(ctx, ws, 'sunset');
    expect(paletteOverrides(ws)).toEqual({});
    expect(paletteColor(ws, 'accent')).toBe(PALETTE_PRESETS.sunset.accent);
    expect(setPalettePreset(ctx, ws, 'sunset')).toBe(ws);
    const settings = ws.entities.settings[0]!;
    const odd = {
      ...ws,
      entities: { ...ws.entities, settings: [{ ...settings, palettePreset: 'not-a-palette' }] },
    };
    expect(palettePreset(odd)).toBe('punchlist');
  });

  it('keep every preset readable: no ring or text color is too faint', () => {
    for (const colors of Object.values(PALETTE_PRESETS)) {
      for (const { slot } of PALETTE_SLOTS) expect(tooFaint(slot, colors[slot])).toBe(false);
    }
  });
});
