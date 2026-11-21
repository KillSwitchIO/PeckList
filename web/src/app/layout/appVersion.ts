/** The project's public repository: PeckList's source, under the AGPL-3.0-or-later. */
export const SOURCE_REPOSITORY_URL = 'https://gitlab.com/killswitch10/pecklist';

/** Where the changes in each version are listed. */
export const CHANGELOG_URL = `${SOURCE_REPOSITORY_URL}/-/blob/main/CHANGELOG.md`;

/** The license's full text. */
export const LICENSE_URL = `${SOURCE_REPOSITORY_URL}/-/blob/main/LICENSE`;

/**
 * The source of the build that is running (the AGPL's offer to everyone who uses it over a
 * network): the commit it was built from, which its release tag points at. A release's version
 * doesn't carry the tag's date (v0.14.0+20261121), so the commit is the exact address. A build with
 * no commit stamped (a local one) gets the repository. A modified build names its own source
 * (`own`, from PECKLIST_SOURCE_URL at build time): ours wouldn't be what it runs.
 */
export function sourceUrl(revision: string, own = ''): string {
  if (own) return own;
  return /^[0-9a-f]{7,40}$/.test(revision)
    ? `${SOURCE_REPOSITORY_URL}/-/tree/${revision}`
    : SOURCE_REPOSITORY_URL;
}

/**
 * The version as the menu shows it: `v0.2.0`, or `v0.1.0-dev.7d865c2` for builds between releases.
 * The commit is added when the version does not name it already.
 */
export function versionLabel(version: string, revision: string): string {
  const named = revision.length > 0 && !version.includes(revision);
  return `v${version}${named ? ` (${revision})` : ''}`;
}

export const APP_VERSION_LABEL = versionLabel(__APP_VERSION__, __APP_REVISION__);

export const APP_SOURCE_URL = sourceUrl(__APP_REVISION__, __APP_SOURCE_URL__);
