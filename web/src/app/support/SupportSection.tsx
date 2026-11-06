import { Box, Button } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { Section } from '../settings/settingsLayout.tsx';
import { DONATION_PLATFORMS } from './links.ts';

/** Thanks and a way to give, and nothing more: it should never look like a nag (spec: PL-112). */
export function SupportSection() {
  return (
    <Section title={t('support.title')} hint={t('support.thanks')} plain>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {DONATION_PLATFORMS.map((platform) => (
          <Button
            key={platform.name}
            variant="outlined"
            href={platform.url}
            target="_blank"
            rel="noreferrer"
          >
            {t('support.give', { name: platform.name })}
          </Button>
        ))}
      </Box>
    </Section>
  );
}
