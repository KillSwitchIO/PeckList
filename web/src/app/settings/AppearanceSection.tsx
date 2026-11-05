import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import {
  Box,
  Button,
  ButtonBase,
  Popover,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import type { PaletteSlot } from '../../core/palette.ts';
import {
  PALETTE_SLOTS,
  paletteColor,
  paletteOverrides,
  presetColor,
  resetPalette,
  setPaletteColor,
  tooFaint,
} from '../../core/paletteSettings.ts';
import { ColorPicker } from '../colors/ColorPicker.tsx';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { THEME_MODE_ORDER, useThemeMode, type ThemeMode } from '../theme/themeMode.ts';
import { PresetPicker } from './PresetPicker.tsx';
import { Section, SettingRow } from './settingsLayout.tsx';

/** A small live sample of the colors as the theme shows them now. */
function Preview() {
  const theme = useTheme();
  const { priority, dateState } = theme.pecklist;
  return (
    <Box
      aria-label={t('palette.preview')}
      role="group"
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 2,
        p: 1.5,
        mb: 1.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
      }}
    >
      <Box sx={{ display: 'flex', gap: 1 }}>
        {(['high', 'medium', 'low', 'none'] as const).map((key) => (
          <Box
            key={key}
            sx={{
              width: 16,
              height: 16,
              borderRadius: '4px',
              border: `1.5px solid ${priority[key].fill}`,
            }}
          />
        ))}
      </Box>
      <Typography variant="body2" sx={{ color: dateState.late }}>
        {t('palette.late')}
      </Typography>
      <Typography variant="body2" sx={{ color: dateState.slipped }}>
        {t('palette.slipped')}
      </Typography>

      <Box
        sx={{
          px: 1,
          py: 0.25,
          borderRadius: 1,
          typography: 'body2',
          bgcolor: theme.pecklist.accentContainer,
          color: theme.pecklist.onAccentContainer,
        }}
      >
        {t('nav.today')}
      </Box>
      <Button size="small" variant="contained" disableElevation tabIndex={-1}>
        {t('palette.accent')}
      </Button>
    </Box>
  );
}

/** One color slot: its name, the color and its code; a click opens the picker. */
function SlotRow({ slot }: { slot: PaletteSlot }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const color = paletteColor(workspace, slot);
  const changed = slot in paletteOverrides(workspace);
  const name = t(`palette.${slot}`);
  const faint = tooFaint(slot, color);
  const set = (next: string | null) => apply((ctx, ws) => setPaletteColor(ctx, ws, slot, next));
  return (
    <>
      <ButtonBase
        aria-label={t('palette.change', { name, color })}
        aria-haspopup="dialog"
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          width: 'calc(100% + 16px)',
          mx: -1,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1,
          py: 1,
          borderRadius: 2,
          textAlign: 'left',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography>{name}</Typography>
          {faint && (
            <Typography
              variant="caption"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'warning.main' }}
            >
              <WarningAmberRounded sx={{ fontSize: 14 }} />
              {t('palette.faint')}
            </Typography>
          )}
        </Box>
        <Typography
          variant="body2"
          color={changed ? 'text.primary' : 'text.secondary'}
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {changed ? color : t('palette.default')}
        </Typography>
        <Box
          sx={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            bgcolor: color,
            border: 1,
            borderColor: 'divider',
            flexShrink: 0,
          }}
        />
      </ButtonBase>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: { role: 'dialog', 'aria-label': name, sx: { borderRadius: 3, p: 1.5 } },
        }}
      >
        <ColorPicker value={color} onChange={set} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
          <Button
            size="small"
            disabled={!changed}
            onClick={() => {
              set(null);
              setAnchor(null);
            }}
          >
            {t('palette.useDefault', { color: presetColor(workspace, slot) })}
          </Button>
          <Button size="small" onClick={() => setAnchor(null)}>
            {t('common.done')}
          </Button>
        </Box>
      </Popover>
    </>
  );
}

/**
 * Settings > Appearance: light or dark, and the colors (PL-018): a preset to start from, then every
 * slot shows live across the app as it changes and syncs with the user's settings; Reset goes back
 * to the preset.
 */
export function AppearanceSection() {
  const workspace = useWorkspace();
  const apply = useApply();
  const changed = Object.keys(paletteOverrides(workspace)).length > 0;
  const { mode, setMode } = useThemeMode();
  return (
    <Stack spacing={4}>
      <Section title={t('settings.appearance')} plain>
        <SettingRow label={t('settings.theme')}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            aria-label={t('settings.theme')}
            onChange={(_, next: ThemeMode | null) => next && setMode(next)}
          >
            {THEME_MODE_ORDER.map((each) => (
              <ToggleButton key={each} value={each}>
                {t(`settings.theme.${each}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </SettingRow>
      </Section>
      <Section
        title={t('settings.colors')}
        hint={t('settings.colorsHint')}
        action={
          <Button
            size="small"
            disabled={!changed}
            onClick={() => apply((ctx, ws) => resetPalette(ctx, ws), t('undo.colorsReset'))}
          >
            {t('palette.reset')}
          </Button>
        }
      >
        <PresetPicker />
        <Preview />
        <Box role="list" aria-label={t('settings.colors')}>
          {PALETTE_SLOTS.map(({ slot }) => (
            <Box role="listitem" key={slot}>
              <SlotRow slot={slot} />
            </Box>
          ))}
        </Box>
      </Section>
    </Stack>
  );
}
