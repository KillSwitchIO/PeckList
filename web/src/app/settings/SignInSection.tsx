import { Alert, Button } from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { SignInMethods } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

const OUTCOMES = ['linked', 'taken', 'not_allowed', 'failed'] as const;
type Outcome = (typeof OUTCOMES)[number];
const isOutcome = (value: string | null): value is Outcome =>
  OUTCOMES.some((each) => each === value);

/**
 * How this account signs in (spec: Accounts & Admin, Linking): its password, the identity
 * provider accounts linked to it with Unlink, and providers it could link. Servers with accounts
 * only. Linking leaves for the provider and comes back to `/settings?link=<outcome>`.
 */
export function SignInSection() {
  const transport = useSyncState((state) => state.transport);
  const hasAccounts = useSyncState(
    (state) => state.phase === 'ready' && state.account?.authMode === 'local',
  );
  const api = hasAccounts ? transport.account : undefined;
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [outcome] = useState<Outcome | null>(() => {
    const value = params.get('link');
    return isOutcome(value) ? value : null;
  });
  const [version, setVersion] = useState(0);

  // The outcome is read once; the address goes back to plain /settings.
  useEffect(() => {
    if (params.has('link')) setParams({}, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.signInMethods().then(
      (answer) => live && setMethods(answer),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, version]);

  if (!api || !methods) return null;
  // Nothing to link and nothing linked: passwords are all there is, no section needed.
  if (methods.identities.length === 0 && methods.canLink.length === 0) return null;

  const unlink = async (provider: string, subject: string) => {
    setProblem(null);
    if ((await api.unlink(provider, subject)) === 'last-way-in') {
      setProblem(t('settings.signIn.lastWayIn'));
    }
    setVersion((each) => each + 1);
  };

  return (
    <Section title={t('settings.signIn')}>
      {outcome && (
        <Alert
          severity={outcome === 'linked' ? 'success' : 'error'}
          variant="outlined"
          sx={{ mb: 1 }}
        >
          {t(`settings.signIn.done.${outcome}`)}
        </Alert>
      )}
      <ProblemAlert problem={problem} sx={{ mb: 1 }} />
      {methods.password && (
        <SettingRow label={t('settings.signIn.password')} hint={t('settings.signIn.passwordOn')} />
      )}
      {methods.identities.map((identity) => (
        <SettingRow
          key={`${identity.provider}:${identity.subject}`}
          label={identity.displayName}
          hint={identity.email ?? identity.subject}
        >
          <Button
            size="small"
            aria-label={t('settings.signIn.unlinkNamed', { name: identity.displayName })}
            onClick={() => void unlink(identity.provider, identity.subject)}
          >
            {t('settings.signIn.unlink')}
          </Button>
        </SettingRow>
      ))}
      {methods.canLink.map((provider) => (
        <SettingRow
          key={provider.name}
          label={provider.displayName}
          hint={t('settings.signIn.notLinked')}
        >
          <Button
            size="small"
            variant="outlined"
            href={provider.url}
            aria-label={t('settings.signIn.linkNamed', { name: provider.displayName })}
          >
            {t('settings.signIn.link')}
          </Button>
        </SettingRow>
      ))}
    </Section>
  );
}
