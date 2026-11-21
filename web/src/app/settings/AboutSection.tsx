import { t } from '../i18n/i18n.ts';
import {
  APP_SOURCE_URL,
  APP_VERSION_LABEL,
  CHANGELOG_URL,
  LICENSE_URL,
} from '../layout/appVersion.ts';
import { useShellInfo } from '../native/shell.ts';
import { ExternalLinkRow, Section, SettingRow } from './settingsLayout.tsx';

/**
 * Which PeckList this is and where its source is. The AGPL asks a server to offer its users the
 * source of what they use (section 13): the Source code row opens this build's own commit, on
 * every server and the demo, whoever runs it.
 */
export function AboutSection() {
  const shellVersion = useShellInfo().info?.version ?? null;
  return (
    <Section title={t('about.title')} hint={t('about.hint')}>
      <SettingRow label={t('about.webVersion')} hint={APP_VERSION_LABEL} />
      {shellVersion && <SettingRow label={t('about.appVersion')} hint={shellVersion} />}
      <ExternalLinkRow
        href={APP_SOURCE_URL}
        label={t('about.source')}
        hint={t('about.sourceHint')}
      />
      <ExternalLinkRow
        href={LICENSE_URL}
        label={t('about.license')}
        hint={t('about.licenseHint')}
      />
      <ExternalLinkRow href={CHANGELOG_URL} label={t('about.changelog')} />
    </Section>
  );
}
