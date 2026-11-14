import { Box, Button, Link, Typography } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { Section } from '../settings/settingsLayout.tsx';
import { DONATION_PLATFORMS } from './links.ts';
import { SupporterKeyBox, SupporterThanks } from './SupporterKeyBox.tsx';
import { purchasedText, SUPPORTER_KEY_URL } from './supporterText.ts';
import { useSupporter } from './useSupporter.ts';

/**
 * Thanks and ways to give, and nothing more: it should never look like a nag (spec: PL-112). A
 * supporter key is bought on the website and only entered here; it unlocks nothing.
 */
export function SupportSection() {
  const { api, status, update } = useSupporter();
  const mine = status?.mine ?? null;
  const server = status?.server ?? null;
  const enter = api?.enterSupporterKey;
  const remove = api?.removeSupporterKey;

  return (
    <Section title={t('support.title')} hint={t('support.thanks')} plain>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box component="section" aria-label={t('support.key.heading')}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            {t('support.key.heading')}
          </Typography>
          {mine && (
            <SupporterThanks
              text={t('support.key.thanksMine', { date: purchasedText(mine) })}
              removeLabel={t('support.key.remove')}
              onRemove={
                remove
                  ? async () => {
                      await remove();
                      update({ mine: null, server });
                    }
                  : undefined
              }
            />
          )}
          {!mine && server && (
            <Box sx={{ mb: 1.5 }}>
              <SupporterThanks
                text={t('support.key.thanksServer', { date: purchasedText(server) })}
              />
            </Box>
          )}
          {!mine && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t('support.key.about')}{' '}
                <Link href={SUPPORTER_KEY_URL} target="_blank" rel="noreferrer">
                  {t('support.key.get')}
                </Link>
              </Typography>
              {status && enter && (
                <SupporterKeyBox
                  wrongKind={t('support.key.serverKey')}
                  onEnter={async (key) => {
                    const answer = await enter(key);
                    if (typeof answer === 'string') return answer;
                    update(answer);
                    return null;
                  }}
                />
              )}
            </>
          )}
        </Box>
        <Box component="section" aria-label={t('support.tip')}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            {t('support.tip')}
          </Typography>
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
        </Box>
      </Box>
    </Section>
  );
}
