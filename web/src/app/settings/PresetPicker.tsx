import CheckRounded from '@mui/icons-material/CheckRounded';
import { Box, ButtonBase, Switch, Typography } from '@mui/material';
import { useState } from 'react';
import { recolorable, recolorToTheme } from '../../core/themeColors.ts';
import { useStoreState } from '../store/hooks.ts';
import { PALETTE_PRESETS, type PalettePreset } from '../../core/palette.ts';
import { palettePreset, paletteOverrides, setPalettePreset } from '../../core/paletteSettings.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';

// Calm first, then soft, then bright, then deep and earthy.
const ORDER: PalettePreset[] = [
  'punchlist',
  'ocean',
  'forest',
  'graphite',
  'rose',
  'blossom',
  'peach',
  'lavender',
  'mint',
  'electric',
  'tropical',
  'citrus',
  'berry',
  'sunset',
  'midnight',
  'coffee',
];
const RECOLOR_KEY = 'punchlist.recolorWithTheme';

const PRESETS = [
  ...ORDER,
  ...(Object.keys(PALETTE_PRESETS) as PalettePreset[]).filter((each) => !ORDER.includes(each)),
];

/**
 * The named palettes (spec: PL-018): each card shows its accent and priority colors. Picking one
 * starts the colors over from it (undo keeps any changes made on the old one).
 */
export function PresetPicker() {
  const workspace = useWorkspace();
  const apply = useApply();
  const current = palettePreset(workspace);
  const changed = Object.keys(paletteOverrides(workspace)).length > 0;
  const me = useStoreState((state) => state.context().userId);
  // A new theme moves lists and tags to its colors too, when this is on (kept on this device).
  const [recolor, setRecolorState] = useState(() => {
    try {
      return localStorage.getItem(RECOLOR_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const setRecolor = (on: boolean) => {
    setRecolorState(on);
    try {
      localStorage.setItem(RECOLOR_KEY, on ? 'on' : 'off');
    } catch {
      // This visit only.
    }
  };
  const { lists, tags } = recolorable(workspace, me);
  return (
    <>
      <Box
        role="radiogroup"
        aria-label={t('palette.presets')}
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
          gap: 1,
          mb: 1.5,
        }}
      >
        {PRESETS.map((preset) => {
          const colors = PALETTE_PRESETS[preset];
          const picked = preset === current;
          return (
            <ButtonBase
              key={preset}
              role="radio"
              aria-checked={picked}
              aria-label={t(`palette.preset.${preset}`)}
              onClick={() => {
                if (preset === current) return;
                apply(
                  (ctx, ws) => {
                    const next = setPalettePreset(ctx, ws, preset);
                    return recolor ? recolorToTheme(ctx, next, preset) : next;
                  },
                  recolor && lists.length + tags.length > 0
                    ? t('undo.themeRecolored')
                    : changed
                      ? t('undo.colorsReset')
                      : undefined,
                );
              }}
              sx={{
                position: 'relative',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 0.75,
                p: 1,
                borderRadius: 2,
                border: 2,
                borderColor: picked ? 'primary.main' : 'divider',
                textAlign: 'left',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box
                sx={{
                  height: 18,
                  borderRadius: 1,
                  bgcolor: colors.accentContainer,
                  display: 'flex',
                }}
              >
                <Box sx={{ width: '40%', borderRadius: 1, bgcolor: colors.accent }} />
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {[
                  colors.priorityHigh,
                  colors.priorityMedium,
                  colors.priorityLow,
                  colors.priorityNone,
                ].map((color, index) => (
                  <Box
                    key={index}
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '3px',
                      border: `2px solid ${color}`,
                    }}
                  />
                ))}
              </Box>
              <Typography variant="caption" sx={{ fontWeight: picked ? 700 : 500 }}>
                {t(`palette.preset.${preset}`)}
              </Typography>
              {picked && (
                <CheckRounded
                  sx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    fontSize: 16,
                    color: 'primary.main',
                  }}
                />
              )}
            </ButtonBase>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, mb: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography>{t('palette.recolorToggle')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('palette.recolorHint')}
          </Typography>
        </Box>
        <Switch
          checked={recolor}
          onChange={(event) => setRecolor(event.target.checked)}
          slotProps={{ input: { 'aria-label': t('palette.recolorToggle') } }}
        />
      </Box>
    </>
  );
}
