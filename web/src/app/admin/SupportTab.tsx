import { Box, Link, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { AdminApi } from '../../ports/admin.ts';
import type { SupporterKeyInfo } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { Section } from '../settings/settingsLayout.tsx';
import { SupporterKeyBox, SupporterThanks } from '../support/SupporterKeyBox.tsx';
import { purchasedText, SUPPORTER_KEY_URL } from '../support/supporterText.ts';

/**
 * Admin > Support (PL-112): the server supporter key, which covers everyone here. Like a person's
 * key it unlocks nothing; it only says thank you and keeps the sidebar reminder away.
 */
export function SupportTab({ api }: { api: AdminApi }) {
  const [key, setKey] = useState<SupporterKeyInfo | null | undefined>(undefined);

  useEffect(() => {
    if (!api.serverSupporter) return;
    let live = true;
    api.serverSupporter().then(
      (answer) => live && setKey(answer),
      () => live && setKey(null),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const enter = api.enterServerSupporterKey;
  const remove = api.removeServerSupporterKey;
  if (!api.serverSupporter || key === undefined) return null;

  return (
    <Section title={t('admin.tab.support')}>
      {key ? (
        <SupporterThanks
          text={t('admin.support.thanks', { date: purchasedText(key) })}
          removeLabel={t('admin.support.remove')}
          onRemove={
            remove
              ? async () => {
                  await remove();
                  setKey(null);
                }
              : undefined
          }
        />
      ) : (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('admin.support.about')}{' '}
            <Link href={SUPPORTER_KEY_URL} target="_blank" rel="noreferrer">
              {t('support.key.get')}
            </Link>
          </Typography>
          {enter && (
            <SupporterKeyBox
              wrongKind={t('support.key.personKey')}
              onEnter={async (text) => {
                const answer = await enter(text);
                if (typeof answer === 'string') return answer;
                setKey(answer);
                return null;
              }}
            />
          )}
        </Box>
      )}
    </Section>
  );
}
