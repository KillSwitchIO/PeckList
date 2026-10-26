import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import {
  Box,
  Button,
  ButtonBase,
  MenuItem,
  Popover,
  Stack,
  TextField,
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
import {
  DUE_SOON_CHOICES,
  POINT_EVENT_CHOICES,
  updateSettings,
  type SettingsPatch,
} from '../../core/settings.ts';
import { ColorPicker } from '../colors/ColorPicker.tsx';
import { ServerSection } from '../native/ServerSection.tsx';
import { THEME_MODE_ORDER, useThemeMode, type ThemeMode } from '../theme/themeMode.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { DataSection } from './DataSection.tsx';
import { ResetSection } from './ResetSection.tsx';
import { DateFormatSetting } from './DateFormatSetting.tsx';
import { NewTaskSection } from './NewTaskSection.tsx';
import { NotificationSettings } from './NotificationSettings.tsx';
import { PresetPicker } from './PresetPicker.tsx';
import { Section, SettingRow } from './settingsLayout.tsx';
import { SignInSection } from './SignInSection.tsx';
import { ProfileSection } from './ProfileSection.tsx';
import { SwipeSection } from './SwipeSection.tsx';
import { TimeZoneSetting } from './TimeZoneSetting.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';

/** A small live sample of the colors as the theme shows them now. */
function Preview() {
  const theme = useTheme();
  const { priority, dateState } = theme.punchlist;
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
          bgcolor: theme.punchlist.accentContainer,
          color: theme.punchlist.onAccentContainer,
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
          width: '100%',
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
 * Settings (spec: PL-025). Colors (PL-018): a preset to start from, then every slot shows live
 * across the app as it changes and syncs with the user's settings; Reset goes back to the preset.
 */
export function SettingsPage() {
  const workspace = useWorkspace();
  const apply = useApply();
  const changed = Object.keys(paletteOverrides(workspace)).length > 0;
  const settings = workspace.entities.settings[0];
  const { mode, setMode } = useThemeMode();
  const change = (patch: SettingsPatch) => apply((ctx, ws) => updateSettings(ctx, ws, patch));
  return (
    <Page title={t('nav.settings')}>
      <Stack spacing={4}>
        <ServerSection />
        <SignInSection />
        <ProfileSection />
        <Section title={t('settings.appearance')}>
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
        <Section title={t('settings.dates')}>
          <TimeZoneSetting
            value={settings?.timeZone ?? null}
            onChange={(timeZone) => change({ timeZone })}
          />
          <DateFormatSetting
            value={settings?.dateFormat ?? null}
            onChange={(dateFormat) => change({ dateFormat })}
          />
          <SettingRow label={t('settings.clock')}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={settings?.clockFormat ?? '12h'}
              aria-label={t('settings.clock')}
              onChange={(_, next: '12h' | '24h' | null) => next && change({ clockFormat: next })}
            >
              <ToggleButton value="12h">{t('settings.clock.12h')}</ToggleButton>
              <ToggleButton value="24h">{t('settings.clock.24h')}</ToggleButton>
            </ToggleButtonGroup>
          </SettingRow>
          <SettingRow label={t('settings.weekStart')}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={settings?.weekStart ?? 0}
              aria-label={t('settings.weekStart')}
              onChange={(_, next: 0 | 1 | null) => next !== null && change({ weekStart: next })}
            >
              <ToggleButton value={0}>{t('settings.weekStart.sunday')}</ToggleButton>
              <ToggleButton value={1}>{t('settings.weekStart.monday')}</ToggleButton>
            </ToggleButtonGroup>
          </SettingRow>
          <SettingRow label={t('settings.dueSoon')} hint={t('settings.dueSoonHint')}>
            <TextField
              select
              size="small"
              value={settings?.dueSoonDays ?? 2}
              onChange={(event) => change({ dueSoonDays: Number(event.target.value) })}
              slotProps={{ htmlInput: { 'aria-label': t('settings.dueSoon') } }}
            >
              {DUE_SOON_CHOICES.map((days) => (
                <MenuItem key={days} value={days}>
                  {days === 0
                    ? t('settings.dueSoon.off')
                    : days === 1
                      ? t('settings.dueSoon.one')
                      : t('settings.dueSoon.days', { days })}
                </MenuItem>
              ))}
            </TextField>
          </SettingRow>
          <SettingRow label={t('settings.pointEvent')} hint={t('settings.pointEventHint')}>
            <TextField
              select
              size="small"
              value={settings?.pointEventMinutes ?? 30}
              onChange={(event) => change({ pointEventMinutes: Number(event.target.value) })}
              slotProps={{ htmlInput: { 'aria-label': t('settings.pointEvent') } }}
            >
              {POINT_EVENT_CHOICES.map((minutes) => (
                <MenuItem key={minutes} value={minutes}>
                  {minutes < 60
                    ? t('settings.minutes', { minutes })
                    : minutes === 60
                      ? t('settings.oneHour')
                      : t('settings.hours', { hours: minutes / 60 })}
                </MenuItem>
              ))}
            </TextField>
          </SettingRow>
        </Section>
        <NewTaskSection />
        <NotificationSettings />
        <SwipeSection />
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
        <DataSection />
        <ResetSection />
      </Stack>
    </Page>
  );
}
