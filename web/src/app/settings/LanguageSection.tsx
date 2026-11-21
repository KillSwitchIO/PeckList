import { ListItemText, MenuItem, TextField } from '@mui/material';
import { updateSettings } from '../../core/settings.ts';
import { availableLanguages, t } from '../i18n/i18n.ts';
import { languageFor, MACHINE_TRANSLATED, ownName } from '../i18n/language.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

const AUTOMATIC = 'auto';

/**
 * Settings > Language and time > Language (PL-148): the language PeckList speaks on every device of
 * this person (synced), or automatic, each device's own. Languages are listed in their own names;
 * a machine-drafted one says so.
 */
export function LanguageSection() {
  const workspace = useWorkspace();
  const apply = useApply();
  const choice = workspace.entities.settings[0]?.language ?? null;
  const picked =
    choice && availableLanguages().includes(choice)
      ? choice
      : choice
        ? languageFor(choice)
        : AUTOMATIC;
  const change = (value: string) =>
    apply((ctx, ws) => updateSettings(ctx, ws, { language: value === AUTOMATIC ? null : value }));
  return (
    <Section title={t('settings.language')} plain>
      <SettingRow label={t('settings.language')} hint={t('settings.language.hint')}>
        <TextField
          select
          size="small"
          value={picked}
          onChange={(event) => change(event.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': t('settings.language') },
            select: { renderValue: (value) => labelOf(value as string) },
          }}
        >
          <MenuItem value={AUTOMATIC}>{labelOf(AUTOMATIC)}</MenuItem>
          {availableLanguages().map((language) => (
            <MenuItem key={language} value={language} lang={language}>
              <ListItemText
                primary={ownName(language)}
                secondary={
                  MACHINE_TRANSLATED.has(language) ? t('settings.language.machine') : undefined
                }
              />
            </MenuItem>
          ))}
        </TextField>
      </SettingRow>
    </Section>
  );
}

function labelOf(value: string): string {
  return value === AUTOMATIC
    ? t('settings.language.auto', { name: ownName(languageFor(null)) })
    : ownName(value);
}
