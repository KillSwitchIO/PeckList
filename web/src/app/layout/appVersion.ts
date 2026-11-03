/** Where the changes in each version are listed. */
export const CHANGELOG_URL = 'https://gitlab.com/killswitch10/pecklist/-/blob/main/CHANGELOG.md';

/**
 * The version as the menu shows it: `v0.2.0`, or `v0.1.0-dev.7d865c2` for builds between releases.
 * The commit is added when the version does not name it already.
 */
export function versionLabel(version: string, revision: string): string {
  const named = revision.length > 0 && !version.includes(revision);
  return `v${version}${named ? ` (${revision})` : ''}`;
}

export const APP_VERSION_LABEL = versionLabel(__APP_VERSION__, __APP_REVISION__);
