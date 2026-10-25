import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { createList, inboxList } from './lists.ts';
import { COLOR_FAMILIES, PALETTE_PRESETS, type PalettePreset } from './palette.ts';
import { createTag } from './tags.ts';
import { recolorToTheme, spectrumSpot, themeSwatches } from './themeColors.ts';
import { createWorkspace } from './workspace.ts';

describe('theme colors for lists and tags', () => {
  it('gives every theme nine colors in spectrum order', () => {
    for (const preset of Object.keys(PALETTE_PRESETS) as PalettePreset[]) {
      const swatches = themeSwatches(preset);
      expect(swatches).toHaveLength(9);
      expect(new Set(swatches).size).toBe(9);
      swatches.forEach((hex, index) => expect(spectrumSpot(hex)).toBe(index));
    }
  });

  it('places family colors and custom ones on the spectrum, and leaves grays out', () => {
    expect(spectrumSpot(COLOR_FAMILIES[0]!.colors[6]!.hex)).toBe(6);
    expect(spectrumSpot('#2050F0')).toBe(6);
    expect(spectrumSpot('#20C060')).toBe(4);
    expect(spectrumSpot('#808080')).toBeNull();
  });

  it('recolors lists and tags to the same spot in the new theme, not the Mess Drawer or grays', () => {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    const blue = createList(ctx, ws, { name: 'Work', color: COLOR_FAMILIES[0]!.colors[6]!.hex });
    ws = blue.workspace;
    const gray = createList(ctx, ws, { name: 'Misc', color: '#808080' });
    ws = gray.workspace;
    const red = createTag(ctx, ws, 'urgent', '#E25C5C');
    ws = red.workspace;
    const inboxColor = inboxList(ws).color;
    const next = recolorToTheme(ctx, ws, 'berry');
    const swatches = themeSwatches('berry');
    const list = (id: string) => next.entities.lists.find((each) => each.id === id)!;
    expect(list(blue.list.id).color).toBe(swatches[6]);
    expect(list(gray.list.id).color).toBe('#808080');
    expect(inboxList(next).color).toBe(inboxColor);
    expect(next.entities.tags.find((tag) => tag.id === red.tag.id)!.color).toBe(swatches[0]);
  });
});
