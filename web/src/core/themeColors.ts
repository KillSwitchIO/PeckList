// Colors for lists and tags that go with each palette (spec: R-FB-65, R-FB-66): nine per theme in
// the same spectrum order as the color families (red, orange, yellow, lime, green, teal, blue,
// violet, pink), taking the theme's own strength and lightness from its accent. Changing the
// theme can move every list and tag to the same spot in the new theme's set.

import { myRole } from './sharing.ts';
import {
  COLOR_FAMILIES,
  hexToRgb,
  PALETTE_PRESETS,
  rgbToHex,
  type PalettePreset,
} from './palette.ts';
import type { OpContext } from './ops.ts';
import { updateList } from './lists.ts';
import { updateTag } from './tags.ts';
import type { WorkspaceFile } from './types.ts';

/** Where each of the nine colors sits on the color wheel. */
const HUES = [356, 26, 46, 80, 145, 182, 212, 262, 322] as const;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === R
      ? ((G - B) / d + (G < B ? 6 : 0)) * 60
      : max === G
        ? ((B - R) / d + 2) * 60
        : ((R - G) / d + 4) * 60;
  return { h, s, l };
}

function fromHsl({ h, s, l }: Hsl): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** A theme's nine list and tag colors, in spectrum order. */
export function themeSwatches(preset: PalettePreset): string[] {
  const accent = toHsl(PALETTE_PRESETS[preset].accent);
  const s = clamp(accent.s, 0.32, 0.8);
  const l = clamp(accent.l, 0.5, 0.72);
  return HUES.map((h) => fromHsl({ h, s, l }));
}

/**
 * The spot (0 to 8) a color takes in the spectrum: its place in a family or a theme's set, else
 * the nearest hue. Grays have none (they stay as they are).
 */
export function spectrumSpot(hex: string): number | null {
  const wanted = hex.toUpperCase();
  for (const item of COLOR_FAMILIES) {
    const index = item.colors.findIndex((color) => color.hex === wanted);
    if (index >= 0) return index;
  }
  for (const preset of Object.keys(PALETTE_PRESETS) as PalettePreset[]) {
    const index = themeSwatches(preset).indexOf(wanted);
    if (index >= 0) return index;
  }
  const { h, s } = toHsl(wanted);
  if (s < 0.12) return null;
  let best = 0;
  HUES.forEach((hue, index) => {
    const away = (a: number) => Math.min(Math.abs(a - h), 360 - Math.abs(a - h));
    if (away(hue) < away(HUES[best]!)) best = index;
  });
  return best;
}

/**
 * Lists and tags a theme change recolors: lists one owns (only owners change a list; not the Mess
 * Drawer) and one's own tags.
 */
export function recolorable(workspace: WorkspaceFile, me: string) {
  const lists = workspace.entities.lists.filter(
    (list) => !list.deletedAt && !list.isInbox && myRole(workspace, me, list.id) === 'owner',
  );
  const tags = workspace.entities.tags.filter((tag) => !tag.deletedAt && tag.createdBy === me);
  return { lists, tags };
}

/** Every list and tag to its spot in the theme's set (grays and unknown colors stay). */
export function recolorToTheme(
  ctx: OpContext,
  workspace: WorkspaceFile,
  preset: PalettePreset,
): WorkspaceFile {
  const swatches = themeSwatches(preset);
  const to = (color: string) => {
    const spot = /^#[0-9a-f]{6}$/i.test(color) ? spectrumSpot(color) : null;
    return spot === null ? null : swatches[spot]!;
  };
  const { lists, tags } = recolorable(workspace, ctx.userId);
  let next = workspace;
  for (const list of lists) {
    const color = to(list.color);
    if (color && color !== list.color) next = updateList(ctx, next, list.id, { color });
  }
  for (const tag of tags) {
    const color = to(tag.color);
    if (color && color !== tag.color) next = updateTag(ctx, next, tag.id, { color });
  }
  return next;
}
