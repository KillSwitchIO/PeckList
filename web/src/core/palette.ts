// Color tokens. One meaning per visual channel (see vault Design Spec). Pastels are used for
// fills, rings and dots; each token also has an `on` variant for text and icons. In dark mode
// the roles flip: fills are muted and the pastel itself is used for text and icons.

export interface ColorToken {
  /** Fill, ring, dot or stripe color */
  fill: string;
  /** Text or icon color that reads on the surface */
  on: string;
}

export interface ModePalette {
  background: string;
  surface: string;
  surfaceVariant: string;
  outline: string;
  text: string;
  textMuted: string;
  accent: ColorToken;
  accentContainer: string;
  /** Text and icons on accentContainer (today, the current pick) */
  onAccentContainer: string;
  priority: { high: ColorToken; medium: ColorToken; low: ColorToken; none: ColorToken };
  dateState: { late: string; slipped: string; dueSoon: string };
  pastels: Record<PastelName, ColorToken>;
}

export const PASTEL_NAMES = [
  'rose',
  'peach',
  'butter',
  'lime',
  'mint',
  'sage',
  'aqua',
  'sky',
  'periwinkle',
  'lavender',
  'mauve',
  'sand',
] as const;
export type PastelName = (typeof PASTEL_NAMES)[number];

const PASTEL_FILLS: Record<PastelName, string> = {
  rose: '#F2A7B5',
  peach: '#F7C59F',
  butter: '#F3E1A0',
  lime: '#CFE3A3',
  mint: '#A8DCC0',
  sage: '#B9CDB0',
  aqua: '#A3D8DC',
  sky: '#A7C7E7',
  periwinkle: '#B5B8EC',
  lavender: '#CDB4E6',
  mauve: '#E0B3D3',
  sand: '#DCCBB5',
};

// --- color math -----------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`invalid color: ${hex}`);
  const value = parseInt(match[1] ?? '', 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** Mix two colors; `amount` 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({
    r: x.r + (y.r - x.r) * amount,
    g: x.g + (y.g - x.g) * amount,
    b: x.b + (y.b - x.b) * amount,
  });
}

/** WCAG 2.x relative luminance */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1 to 21 */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken (towards black) or lighten (towards white) `color` until it reaches `target` contrast on `surface`. */
export function ensureContrast(color: string, surface: string, target: number): string {
  if (contrastRatio(color, surface) >= target) return color;
  const towards = luminance(surface) > 0.5 ? '#000000' : '#FFFFFF';
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mix(color, towards, step / 100);
    if (contrastRatio(candidate, surface) >= target) return candidate;
  }
  return towards;
}

export const WCAG_TEXT = 4.5;
export const WCAG_UI = 3;

// --- palettes -------------------------------------------------------------------------

function token(fill: string, surface: string, dark: boolean): ColorToken {
  if (dark) {
    // Dark mode: muted fill, pastel as the readable foreground.
    return { fill: mix(fill, '#000000', 0.55), on: ensureContrast(fill, surface, WCAG_TEXT) };
  }
  return { fill, on: ensureContrast(fill, surface, WCAG_TEXT) };
}

function ring(fill: string, surface: string): ColorToken {
  // Priority rings are UI elements: they need 3:1 against the surface themselves.
  const visible = ensureContrast(fill, surface, WCAG_UI);
  return { fill: visible, on: ensureContrast(fill, surface, WCAG_TEXT) };
}

/** The colors a user can change (the palette editor's slots) and what each starts as. */
export const PALETTE_DEFAULTS = {
  accent: '#4F8F87',
  accentContainer: '#CDE8E3',
  priorityHigh: '#E8837E',
  priorityMedium: '#F0B072',
  priorityLow: '#8FA8E0',
  priorityNone: '#B8BCC4',
  late: '#E8837E',
  slipped: '#F0B072',
} as const;

export type PaletteSlot = keyof typeof PALETTE_DEFAULTS;

/**
 * Named palettes to start from (spec: PL-018, R-FB-09; soft, bright and earthy ones R-FB-52). Each sets every slot; the person's own
 * changes go on top. The pastel rings and text are darkened on screen as needed, like the defaults.
 */
export const PALETTE_PRESETS = {
  punchlist: PALETTE_DEFAULTS,
  ocean: {
    accent: '#3A7CA5',
    accentContainer: '#CFE3F2',
    priorityHigh: '#E07A7A',
    priorityMedium: '#E8B26A',
    priorityLow: '#7FA7D9',
    priorityNone: '#B8BCC4',
    late: '#E07A7A',
    slipped: '#E8B26A',
  },
  forest: {
    accent: '#5A8A4E',
    accentContainer: '#DCEBD3',
    priorityHigh: '#D9776B',
    priorityMedium: '#E3B068',
    priorityLow: '#8DAA9B',
    priorityNone: '#B8BCC4',
    late: '#D9776B',
    slipped: '#E3B068',
  },
  sunset: {
    accent: '#C46A4A',
    accentContainer: '#F6DCCF',
    priorityHigh: '#D95F6E',
    priorityMedium: '#E9A15B',
    priorityLow: '#9A8FD1',
    priorityNone: '#BDB7B2',
    late: '#D95F6E',
    slipped: '#E9A15B',
  },
  lavender: {
    accent: '#7B6CB8',
    accentContainer: '#E3DEF5',
    priorityHigh: '#E27D8E',
    priorityMedium: '#EDB26F',
    priorityLow: '#8CB2DE',
    priorityNone: '#BDBCC8',
    late: '#E27D8E',
    slipped: '#EDB26F',
  },
  graphite: {
    accent: '#5C6670',
    accentContainer: '#DDE1E5',
    priorityHigh: '#D9534F',
    priorityMedium: '#E0A040',
    priorityLow: '#6F8FB8',
    priorityNone: '#B0B5BB',
    late: '#D9534F',
    slipped: '#E0A040',
  },
  rose: {
    accent: '#C2577F',
    accentContainer: '#F7DCE6',
    priorityHigh: '#E0607E',
    priorityMedium: '#F2A65A',
    priorityLow: '#9C8FD9',
    priorityNone: '#C4B8BE',
    late: '#E0607E',
    slipped: '#F2A65A',
  },
  blossom: {
    accent: '#B86FA8',
    accentContainer: '#F3DFF0',
    priorityHigh: '#E87A90',
    priorityMedium: '#F2B880',
    priorityLow: '#8FB5E8',
    priorityNone: '#C8BFC8',
    late: '#E87A90',
    slipped: '#F2B880',
  },
  peach: {
    accent: '#D9785B',
    accentContainer: '#FBE3D8',
    priorityHigh: '#E5657A',
    priorityMedium: '#F2B25C',
    priorityLow: '#7FB3C8',
    priorityNone: '#C9BDB6',
    late: '#E5657A',
    slipped: '#F2B25C',
  },
  mint: {
    accent: '#3FA07F',
    accentContainer: '#D3F1E6',
    priorityHigh: '#E8747C',
    priorityMedium: '#EDB25E',
    priorityLow: '#7FA3E0',
    priorityNone: '#B8C2BE',
    late: '#E8747C',
    slipped: '#EDB25E',
  },
  electric: {
    accent: '#2F6BFF',
    accentContainer: '#D6E2FF',
    priorityHigh: '#FF4D5E',
    priorityMedium: '#FF9F1C',
    priorityLow: '#3DB2FF',
    priorityNone: '#A9B0BC',
    late: '#FF4D5E',
    slipped: '#FF9F1C',
  },
  tropical: {
    accent: '#00A39A',
    accentContainer: '#C8F2EE',
    priorityHigh: '#FF4F79',
    priorityMedium: '#FFB000',
    priorityLow: '#7B61FF',
    priorityNone: '#AEB6BF',
    late: '#FF4F79',
    slipped: '#FFB000',
  },
  citrus: {
    accent: '#6FA318',
    accentContainer: '#E3F4C6',
    priorityHigh: '#F2542D',
    priorityMedium: '#F5A300',
    priorityLow: '#2BA3C9',
    priorityNone: '#B5BAA8',
    late: '#F2542D',
    slipped: '#F5A300',
  },
  berry: {
    accent: '#9C2A8C',
    accentContainer: '#F3D4EE',
    priorityHigh: '#E8335A',
    priorityMedium: '#F08A24',
    priorityLow: '#5B7BE0',
    priorityNone: '#BDB3BF',
    late: '#E8335A',
    slipped: '#F08A24',
  },
  midnight: {
    accent: '#4A55C9',
    accentContainer: '#DADDFA',
    priorityHigh: '#E5566B',
    priorityMedium: '#EAA64A',
    priorityLow: '#53A6D6',
    priorityNone: '#B3B6C6',
    late: '#E5566B',
    slipped: '#EAA64A',
  },
  coffee: {
    accent: '#8A6A50',
    accentContainer: '#EDE0D4',
    priorityHigh: '#C8574E',
    priorityMedium: '#D9A048',
    priorityLow: '#7E9BB0',
    priorityNone: '#BDB4AA',
    late: '#C8574E',
    slipped: '#D9A048',
  },
} as const satisfies Record<string, Record<PaletteSlot, string>>;

export type PalettePreset = keyof typeof PALETTE_PRESETS;
export const DEFAULT_PRESET: PalettePreset = 'punchlist';

export const LIGHT_SURFACE = '#FFFFFF';
export const DARK_SURFACE = '#24272A';

export function buildPalette(
  mode: 'light' | 'dark',
  overrides: Partial<Record<string, string>> = {},
): ModePalette {
  const dark = mode === 'dark';
  const surface = dark ? DARK_SURFACE : LIGHT_SURFACE;
  const fill = (name: string, fallback: string) => overrides[name] ?? fallback;
  const pastels = Object.fromEntries(
    PASTEL_NAMES.map((name) => [name, token(fill(name, PASTEL_FILLS[name]), surface, dark)]),
  ) as Record<PastelName, ColorToken>;
  const accentSeed = fill('accent', PALETTE_DEFAULTS.accent);
  return {
    background: dark ? '#1B1D1F' : '#FAFAF7',
    surface,
    surfaceVariant: dark ? '#2E3236' : '#F1F2EE',
    outline: dark ? '#41464B' : '#D9DBD6',
    text: dark ? '#E6E7E4' : '#1F2224',
    textMuted: dark ? '#A9ADB1' : '#5C6266',
    accent: {
      // Light mode: darken the seed just enough for white button text to pass AA.
      fill: dark
        ? ensureContrast(mix(accentSeed, '#FFFFFF', 0.35), surface, WCAG_UI)
        : ensureContrast(accentSeed, '#FFFFFF', WCAG_TEXT),
      on: dark ? '#0F2E2A' : '#FFFFFF',
    },
    accentContainer: dark
      ? mix(accentSeed, '#000000', 0.45)
      : fill('accentContainer', PALETTE_DEFAULTS.accentContainer),
    onAccentContainer: dark
      ? ensureContrast(mix(accentSeed, '#FFFFFF', 0.5), mix(accentSeed, '#000000', 0.45), WCAG_TEXT)
      : ensureContrast(
          mix(accentSeed, '#000000', 0.25),
          fill('accentContainer', PALETTE_DEFAULTS.accentContainer),
          WCAG_TEXT,
        ),
    priority: {
      high: ring(fill('priorityHigh', PALETTE_DEFAULTS.priorityHigh), surface),
      medium: ring(fill('priorityMedium', PALETTE_DEFAULTS.priorityMedium), surface),
      low: ring(fill('priorityLow', PALETTE_DEFAULTS.priorityLow), surface),
      none: ring(fill('priorityNone', PALETTE_DEFAULTS.priorityNone), surface),
    },
    dateState: {
      late: ensureContrast(fill('late', PALETTE_DEFAULTS.late), surface, WCAG_TEXT),
      slipped: ensureContrast(fill('slipped', PALETTE_DEFAULTS.slipped), surface, WCAG_TEXT),
      dueSoon: ensureContrast(accentSeed, surface, WCAG_TEXT),
    },
    pastels,
  };
}

/**
 * Soft pill colors for a user-chosen fill (tag chips): a tinted background with text that
 * passes AA on it, in either mode.
 */
export function chipColors(color: string, mode: 'light' | 'dark'): { bg: string; fg: string } {
  if (mode === 'dark') {
    const bg = mix(color, '#24272A', 0.78);
    return { bg, fg: ensureContrast(color, bg, WCAG_TEXT) };
  }
  const bg = mix(color, '#FFFFFF', 0.45);
  return { bg, fg: ensureContrast(mix(color, '#000000', 0.55), bg, WCAG_TEXT) };
}

// --- color families for lists and tags ------------------------------------------------

export interface ColorFamily {
  id: 'pastel' | 'muted' | 'earthy' | 'classic' | 'vivid';
  /** Nine colors in spectrum order (red, orange, yellow, lime, green, teal, blue, violet, pink) */
  colors: { id: string; hex: string }[];
}

const family = (id: ColorFamily['id'], hexes: string[]): ColorFamily => ({
  id,
  colors: hexes.map((hex, index) => ({ id: `${id}-${index + 1}`, hex })),
});

/** Families users can keep their tags in: soft, dusty, earthy, classic or bright. */
export const COLOR_FAMILIES: ColorFamily[] = [
  family('pastel', [
    '#F2A7B5',
    '#F7C59F',
    '#F3E1A0',
    '#CFE3A3',
    '#A8DCC0',
    '#A3D8DC',
    '#A7C7E7',
    '#CDB4E6',
    '#E0B3D3',
  ]),
  family('muted', [
    '#C98B8B',
    '#D4A373',
    '#CDB86E',
    '#A7B27A',
    '#8FAE95',
    '#7FAAA8',
    '#8BA3C2',
    '#A592B8',
    '#BE8FA8',
  ]),
  family('earthy', [
    '#B5654A',
    '#C98B3C',
    '#B9A046',
    '#7E8F4E',
    '#5E8C6A',
    '#4F8A8B',
    '#4F6D8F',
    '#7A6390',
    '#A0566E',
  ]),
  family('classic', [
    '#E25C5C',
    '#F0913A',
    '#F2C94C',
    '#A8C94A',
    '#4CB782',
    '#3BB0B5',
    '#4A90D9',
    '#8E6CD8',
    '#D965A8',
  ]),
  family('vivid', [
    '#FF3B30',
    '#FF8A00',
    '#FFCC00',
    '#9BE000',
    '#00C46A',
    '#00BFC8',
    '#2F7BFF',
    '#8A4DFF',
    '#FF3D9A',
  ]),
];

/** The family and position of a color, or null for a custom color. */
export function findFamilyColor(hex: string): { family: ColorFamily; index: number } | null {
  const wanted = hex.toUpperCase();
  for (const item of COLOR_FAMILIES) {
    const index = item.colors.findIndex((color) => color.hex === wanted);
    if (index >= 0) return { family: item, index };
  }
  return null;
}
