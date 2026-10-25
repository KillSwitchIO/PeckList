import CheckRounded from '@mui/icons-material/CheckRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { Box, ButtonBase, InputBase, ListItemIcon, Menu, MenuItem, useTheme } from '@mui/material';
import { useState } from 'react';
import {
  COLOR_FAMILIES,
  findFamilyColor,
  PALETTE_PRESETS,
  type ColorFamily,
  type PalettePreset,
} from '../../core/palette.ts';
import { palettePreset } from '../../core/paletteSettings.ts';
import { themeSwatches } from '../../core/themeColors.ts';
import { t } from '../i18n/i18n.ts';
import { useWorkspace } from '../store/hooks.ts';

const HUES = [
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
] as const;
const SWATCH = 28;
const HEX = /^#?([0-9a-f]{6})$/i;
const PRESETS = Object.keys(PALETTE_PRESETS) as PalettePreset[];

/** Where the swatches come from: a color family, or a theme's own set. */
type Source = { kind: 'family'; id: ColorFamily['id'] } | { kind: 'theme'; preset: PalettePreset };

/** The family or theme a color comes from, if any. */
function sourceOf(hex: string): Source | null {
  const spot = findFamilyColor(hex);
  if (spot) return { kind: 'family', id: spot.family.id };
  const wanted = hex.toUpperCase();
  const preset = PRESETS.find((each) => themeSwatches(each).includes(wanted));
  return preset ? { kind: 'theme', preset } : null;
}

const sameSource = (a: Source, b: Source) =>
  a.kind === 'family'
    ? b.kind === 'family' && a.id === b.id
    : b.kind === 'theme' && a.preset === b.preset;

function Swatch({
  color,
  label,
  selected,
  onClick,
}: {
  color: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const theme = useTheme();
  return (
    <ButtonBase
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onClick}
      sx={{
        width: SWATCH,
        height: SWATCH,
        borderRadius: '50%',
        bgcolor: color,
        color: '#FFFFFF',
        // A ring with a gap reads as "selected" on any color, light or dark.
        boxShadow: selected
          ? `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${theme.palette.text.primary}`
          : 'none',
        transition: 'box-shadow 120ms',
      }}
    >
      {selected && <CheckRounded sx={{ fontSize: 16, filter: 'drop-shadow(0 0 1px #0008)' }} />}
    </ButtonBase>
  );
}

const chipSx = (active: boolean) => ({
  px: 1.25,
  py: 0.5,
  borderRadius: 999,
  typography: 'body2',
  fontWeight: active ? 600 : 400,
  color: active ? 'text.primary' : 'text.secondary',
  bgcolor: active ? 'action.selected' : 'transparent',
  '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
});

/** A tiny preview of a set's look: its colors round a dot. */
const dot = (colors: string[], size: number) => (
  <Box
    component="span"
    aria-hidden
    sx={{
      width: size,
      height: size,
      mr: 0.75,
      flexShrink: 0,
      borderRadius: '50%',
      background: `conic-gradient(${colors.join(', ')})`,
    }}
  />
);

/**
 * Color choice for lists and tags (spec: R-FB-66): the current theme's nine colors first, then
 * the families (pastel to vivid), any other theme's set from More themes, and a custom color for
 * anything else.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const theme = useTheme();
  const current = palettePreset(useWorkspace());
  const found = sourceOf(value);
  const [source, setSource] = useState<Source>(found ?? { kind: 'theme', preset: current });
  const [customOpen, setCustomOpen] = useState(found === null);
  const [themesAnchor, setThemesAnchor] = useState<HTMLElement | null>(null);
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());
  const [syncedValue, setSyncedValue] = useState(value);
  // Follow outside changes (a new suggested default) without an effect.
  if (value !== syncedValue) {
    setSyncedValue(value);
    setHexDraft(value.toUpperCase());
    const next = sourceOf(value);
    if (next) setSource(next);
  }
  const swatches =
    source.kind === 'family'
      ? COLOR_FAMILIES.find((item) => item.id === source.id)!.colors.map((color) => color.hex)
      : themeSwatches(source.preset);
  const sourceName =
    source.kind === 'family'
      ? t(`color.family.${source.id}`)
      : t(`palette.preset.${source.preset}`);
  const isCustom = found === null;
  // This theme, the families, and a theme picked from More themes (when another).
  const chips: { source: Source; label: string; colors: string[] }[] = [
    {
      source: { kind: 'theme', preset: current },
      label: t('color.yourTheme', { theme: t(`palette.preset.${current}`) }),
      colors: themeSwatches(current),
    },
    ...COLOR_FAMILIES.map((item) => ({
      source: { kind: 'family', id: item.id } as Source,
      label: t(`color.family.${item.id}`),
      colors: item.colors.map((color) => color.hex),
    })),
    ...(source.kind === 'theme' && source.preset !== current
      ? [{ source, label: sourceName, colors: themeSwatches(source.preset) }]
      : []),
  ];

  const commitHex = (text: string) => {
    const match = HEX.exec(text.trim());
    if (match) onChange(`#${match[1]!.toUpperCase()}`);
  };

  return (
    <Box>
      <Box
        role="group"
        aria-label={t('color.families')}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.25 }}
      >
        {chips.map((chip) => {
          const active = sameSource(chip.source, source);
          return (
            <ButtonBase
              key={chip.label}
              aria-pressed={active}
              onClick={() => setSource(chip.source)}
              sx={chipSx(active)}
            >
              {dot(chip.colors, 10)}
              {chip.label}
            </ButtonBase>
          );
        })}
        <ButtonBase
          aria-haspopup="menu"
          onClick={(event) => setThemesAnchor(event.currentTarget)}
          sx={chipSx(false)}
        >
          {t('color.moreThemes')}
          <ExpandMoreRounded sx={{ fontSize: 18, ml: 0.25 }} />
        </ButtonBase>
        <Menu
          anchorEl={themesAnchor}
          open={themesAnchor !== null}
          onClose={() => setThemesAnchor(null)}
        >
          {PRESETS.map((preset) => (
            <MenuItem
              key={preset}
              dense
              selected={source.kind === 'theme' && source.preset === preset}
              onClick={() => {
                setSource({ kind: 'theme', preset });
                setThemesAnchor(null);
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>{dot(themeSwatches(preset), 14)}</ListItemIcon>
              {t(`palette.preset.${preset}`)}
            </MenuItem>
          ))}
        </Menu>
      </Box>

      <Box
        role="radiogroup"
        aria-label={t('list.color')}
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25, p: 0.5 }}
      >
        {swatches.map((hex, index) => (
          <Swatch
            key={hex}
            color={hex}
            label={`${sourceName} ${t(`color.hue.${HUES[index]!}`)}`}
            selected={value.toUpperCase() === hex}
            onClick={() => onChange(hex)}
          />
        ))}
        <ButtonBase
          role="radio"
          aria-checked={isCustom}
          aria-label={t('color.custom')}
          onClick={() => setCustomOpen(true)}
          sx={{
            width: SWATCH,
            height: SWATCH,
            borderRadius: '50%',
            // Rainbow ring around the custom color (or the paper when none is set).
            background: `radial-gradient(circle, ${isCustom ? value : theme.palette.background.paper} 52%, transparent 54%), conic-gradient(#FF3B30, #FFCC00, #00C46A, #00BFC8, #2F7BFF, #8A4DFF, #FF3D9A, #FF3B30)`,
            boxShadow: isCustom
              ? `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${theme.palette.text.primary}`
              : 'none',
          }}
        />
      </Box>

      {customOpen && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.25 }}>
          <Box
            component="label"
            sx={{
              position: 'relative',
              width: 36,
              height: 28,
              borderRadius: 1.5,
              bgcolor: value,
              border: 1,
              borderColor: 'divider',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <Box
              component="input"
              type="color"
              aria-label={t('color.pick')}
              value={value.toLowerCase()}
              onChange={(event) => onChange(event.target.value.toUpperCase())}
              sx={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
            />
          </Box>
          <InputBase
            value={hexDraft}
            inputProps={{ 'aria-label': t('color.hex'), spellCheck: false, maxLength: 7 }}
            onChange={(event) => {
              setHexDraft(event.target.value);
              commitHex(event.target.value);
            }}
            onBlur={() => setHexDraft(value.toUpperCase())}
            sx={{
              width: 96,
              px: 1,
              py: 0.25,
              borderRadius: 1.5,
              bgcolor: 'action.hover',
              fontFamily: 'ui-monospace, monospace',
              typography: 'body2',
            }}
          />
        </Box>
      )}
    </Box>
  );
}
