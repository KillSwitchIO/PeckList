import { describe, expect, it } from 'vitest';
import {
  buildPalette,
  chipColors,
  COLOR_FAMILIES,
  findFamilyColor,
  contrastRatio,
  ensureContrast,
  hexToRgb,
  mix,
  PASTEL_NAMES,
  PRESET_TINTS,
  rgbToHex,
  WCAG_TEXT,
  WCAG_UI,
} from './palette.ts';

describe('color math', () => {
  it('converts hex and back', () => {
    expect(hexToRgb('#4F8F87')).toEqual({ r: 79, g: 143, b: 135 });
    expect(rgbToHex({ r: 79, g: 143, b: 135 })).toBe('#4F8F87');
    expect(() => hexToRgb('red')).toThrow('invalid color');
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
  });

  it('mixes colors', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('adjusts colors until they meet a contrast target', () => {
    const adjusted = ensureContrast('#F3E1A0', '#FFFFFF', WCAG_TEXT);
    expect(contrastRatio(adjusted, '#FFFFFF')).toBeGreaterThanOrEqual(WCAG_TEXT);
    expect(ensureContrast('#000000', '#FFFFFF', WCAG_TEXT)).toBe('#000000');
    expect(ensureContrast('#FFFFFF', '#FFFFFF', 30)).toBe('#000000');
  });
});

// WCAG 2.2 AA for every token pair, in both modes (vault: Design Spec, contrast rules)
describe.each(['light', 'dark'] as const)('%s palette meets WCAG 2.2 AA', (mode) => {
  const p = buildPalette(mode);

  it('body and muted text on background and surface', () => {
    for (const bg of [p.background, p.surface, p.surfaceVariant]) {
      expect(contrastRatio(p.text, bg)).toBeGreaterThanOrEqual(WCAG_TEXT);
      expect(contrastRatio(p.textMuted, bg)).toBeGreaterThanOrEqual(WCAG_TEXT);
    }
  });

  it('accent buttons are readable and visible', () => {
    expect(contrastRatio(p.accent.on, p.accent.fill)).toBeGreaterThanOrEqual(WCAG_TEXT);
    expect(contrastRatio(p.accent.fill, p.surface)).toBeGreaterThanOrEqual(WCAG_UI);
  });

  it('priority rings are visible and their text variants readable', () => {
    for (const level of ['high', 'medium', 'low', 'none'] as const) {
      expect(contrastRatio(p.priority[level].fill, p.surface)).toBeGreaterThanOrEqual(WCAG_UI);
      expect(contrastRatio(p.priority[level].on, p.surface)).toBeGreaterThanOrEqual(WCAG_TEXT);
    }
  });

  it('date state text is readable', () => {
    for (const color of Object.values(p.dateState)) {
      expect(contrastRatio(color, p.surface)).toBeGreaterThanOrEqual(WCAG_TEXT);
    }
  });

  it('every pastel has a readable text variant', () => {
    for (const name of PASTEL_NAMES) {
      expect(contrastRatio(p.pastels[name].on, p.surface)).toBeGreaterThanOrEqual(WCAG_TEXT);
    }
  });
});

describe('overrides', () => {
  it('apply to pastel and accent slots and stay accessible', () => {
    const p = buildPalette('light', { rose: '#FFEEEE', accent: '#AACCAA' });
    expect(p.pastels.rose.fill).toBe('#FFEEEE');
    expect(contrastRatio(p.pastels.rose.on, p.surface)).toBeGreaterThanOrEqual(WCAG_TEXT);
    expect(contrastRatio(p.accent.on, p.accent.fill)).toBeGreaterThanOrEqual(WCAG_TEXT);
  });
});

describe('chip colors', () => {
  it.each(['light', 'dark'] as const)('keep tag chip text readable in %s mode', (mode) => {
    const light = buildPalette('light');
    const fills = [
      ...PASTEL_NAMES.map((name) => light.pastels[name].fill),
      ...COLOR_FAMILIES.flatMap((family) => family.colors.map((color) => color.hex)),
      '#000000',
      '#FFFFFF',
    ];
    for (const fill of fills) {
      const { bg, fg } = chipColors(fill, mode);
      expect(contrastRatio(fg, bg), fill).toBeGreaterThanOrEqual(WCAG_TEXT);
    }
  });
});

describe('color families', () => {
  it('have nine distinct colors each and find a color back', () => {
    const all = COLOR_FAMILIES.flatMap((family) => family.colors.map((color) => color.hex));
    expect(COLOR_FAMILIES.every((family) => family.colors.length === 9)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(findFamilyColor('#ff3b30')).toMatchObject({ family: { id: 'vivid' }, index: 0 });
    expect(findFamilyColor('#123456')).toBeNull();
  });
});

describe.each(['light', 'dark'] as const)('%s accent container', (mode) => {
  it('keeps today and the current pick readable', () => {
    const p = buildPalette(mode);
    expect(contrastRatio(p.onAccentContainer, p.accentContainer)).toBeGreaterThanOrEqual(WCAG_TEXT);
  });
});

describe('washed palettes (R-FB-123)', () => {
  it('tints the page and panels in the accent, keeping text readable', () => {
    const plain = buildPalette('light', { accent: '#FF2E93' });
    const washed = buildPalette('light', { accent: '#FF2E93' }, 0.08);
    expect(washed.background).not.toBe(plain.background);
    expect(washed.surface).not.toBe(plain.surface);
    expect(contrastRatio(washed.text, washed.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(washed.textMuted, washed.surface)).toBeGreaterThanOrEqual(4.5);
    const dark = buildPalette('dark', { accent: '#FF2E93' }, 0.08);
    expect(contrastRatio(dark.text, dark.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('gives every loud and pretty palette a wash', () => {
    for (const id of ['neon', 'arcade', 'bubblegum', 'rose-gold'] as const) {
      expect(PRESET_TINTS[id]).toBeGreaterThan(0);
    }
    expect(PRESET_TINTS.punchlist).toBeUndefined();
  });
});
