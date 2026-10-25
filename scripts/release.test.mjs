// pnpm test:scripts   (also run by the CI lint job)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { releaseNotes } from './release-notes.mjs';
import { SEMVER, parseTag, readVersions } from './versions.mjs';

test('a release tag carries the version and the date as build metadata', () => {
  assert.deepEqual(parseTag('v0.4.0+20261023'), {
    version: '0.4.0',
    build: '20261023',
    prerelease: false,
  });
  assert.deepEqual(parseTag('v1.0.0-rc.1+20261101'), {
    version: '1.0.0-rc.1',
    build: '20261101',
    prerelease: true,
  });
  assert.throws(() => parseTag('v1.2'), /not a release tag/);
  assert.throws(() => parseTag('nightly'), /not a release tag/);
});

test('versions are plain semver cores, optionally pre-release', () => {
  for (const good of ['0.1.0', '1.20.3', '2.0.0-beta.2']) assert.ok(SEMVER.test(good), good);
  for (const bad of ['01.0.0', '1.0', '1.0.0+1', 'v1.0.0']) assert.ok(!SEMVER.test(bad), bad);
});

test('release notes are one version section of the changelog, without its heading', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [0.3.0] - 2026-11-01',
    '',
    '### Added',
    '',
    '- Newer thing',
    '',
    '## [0.2.0] - 2026-10-23',
    '',
    '### Fixed',
    '',
    '- Older fix',
  ].join('\r\n');
  assert.equal(releaseNotes(changelog, '0.3.0'), '### Added\n\n- Newer thing');
  assert.equal(releaseNotes(changelog, '0.2.0'), '### Fixed\n\n- Older fix');
  assert.equal(releaseNotes(changelog, '0.1.0'), null);
});

test('every place that holds the version holds the same one', () => {
  const versions = readVersions();
  assert.equal(versions.length, 3);
  assert.equal(new Set(versions.map((each) => each.version)).size, 1);
});

/** What scripts/build-version.sh says for a version file and GitLab's variables. */
function buildVersion(current, env) {
  const dir = mkdtempSync(join(tmpdir(), 'punchlist-version-'));
  const props = join(dir, 'Directory.Build.props');
  writeFileSync(
    props,
    `<Project><PropertyGroup><Version>${current}</Version></PropertyGroup></Project>`,
  );
  return execFileSync('sh', [join(import.meta.dirname, 'build-version.sh')], {
    env: { PATH: process.env.PATH, VERSION_PROPS: props, CI_DEFAULT_BRANCH: 'main', ...env },
    encoding: 'utf8',
  }).trim();
}

test('a build between releases is the next patch, so it sorts after the release it follows', () => {
  const sha = { CI_COMMIT_SHORT_SHA: 'abc1234' };
  assert.equal(buildVersion('0.2.0', { ...sha, CI_COMMIT_BRANCH: 'main' }), '0.2.1-edge.abc1234');
  assert.equal(buildVersion('0.2.0', { ...sha, CI_COMMIT_BRANCH: 'fix/x' }), '0.2.1-dev.abc1234');
  assert.equal(buildVersion('0.2.0', sha), '0.2.1-dev.abc1234');
  // After a pre-release: after that rc, before the release.
  assert.equal(
    buildVersion('0.3.0-rc.1', { ...sha, CI_COMMIT_BRANCH: 'main' }),
    '0.3.0-rc.1.edge.abc1234',
  );
  for (const each of ['0.2.1-edge.abc1234', '0.3.0-rc.1.edge.abc1234']) {
    assert.ok(SEMVER.test(each), each);
  }
});

test('a release tag builds exactly its version', () => {
  assert.equal(buildVersion('0.2.0', { CI_COMMIT_TAG: 'v0.2.0+20261025' }), '0.2.0');
  assert.equal(buildVersion('0.3.0-rc.1', { CI_COMMIT_TAG: 'v0.3.0-rc.1+20261101' }), '0.3.0-rc.1');
});
