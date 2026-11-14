// pnpm test:scripts   (also run by the CI lint job)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { releaseNotes, withSection } from './release-notes.mjs';
import {
  SEMVER,
  androidVersionCode,
  nextVersion,
  parseTag,
  readAndroidVersionCode,
  readVersions,
  releaseKind,
} from './versions.mjs';

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

test('a release adds its section on top, and every older section stays as it was', () => {
  const header = '# Changelog\n\nAll notable changes.\n\n';
  const older = [
    '## [0.9.0-rc.1] - 2026-11-08',
    '',
    '### Added',
    '',
    '- Year view',
    '',
    '## [0.8.0] - 2026-11-06',
    '',
    '### Added',
    '- Hooks',
    '',
    '## [0.8.0-rc.2] - 2026-11-06',
    '',
    '### Fixed',
    '',
    '- A fix',
    '',
  ].join('\n');
  // git-cliff's output for a final release carries its release candidates' entries.
  const section = '## [0.9.0] - 2026-11-08\n\n### Added\n\n- Year view\n\n\n';
  const updated = withSection(header + older, '0.9.0', section);
  assert.equal(updated, `${header}## [0.9.0] - 2026-11-08\n\n### Added\n\n- Year view\n\n${older}`);
  assert.equal(releaseNotes(updated, '0.9.0'), '### Added\n\n- Year view');
  assert.equal(releaseNotes(updated, '0.9.0-rc.1'), '### Added\n\n- Year view');
  assert.equal(releaseNotes(updated, '0.8.0-rc.2'), '### Fixed\n\n- A fix');

  // Prepared again, or after `Unreleased`: the section is replaced, not doubled.
  assert.equal(withSection(updated, '0.9.0', section), updated);
  const unreleased = `${header}## Unreleased\n\n### Fixed\n\n- Pending\n\n${older}`;
  assert.equal(withSection(unreleased, '0.9.0', section), updated);

  // The first release, and a file with Windows line endings.
  assert.equal(
    withSection(header, '0.1.0', '## [0.1.0] - 2026-10-01\n\n- First\n'),
    `${header}## [0.1.0] - 2026-10-01\n\n- First\n\n`,
  );
  assert.equal(
    withSection((header + older).replaceAll('\n', '\r\n'), '0.9.0', section),
    updated.replaceAll('\n', '\r\n'),
  );
});

test('every place that holds the version holds the same one', () => {
  const versions = readVersions();
  assert.equal(versions.length, 4);
  assert.equal(new Set(versions.map((each) => each.version)).size, 1);
  assert.equal(readAndroidVersionCode(), androidVersionCode(versions[0].version));
});

test('the Android version code grows with each release, and an rc sorts before its release', () => {
  assert.equal(androidVersionCode('0.12.0-rc.1'), 1_200_001);
  assert.equal(androidVersionCode('0.12.0-rc.2'), 1_200_002);
  assert.equal(androidVersionCode('0.12.0'), 1_200_999);
  // A build between releases: after the release it follows, before the next one's rc.
  assert.equal(androidVersionCode('0.12.1-edge.abc1234'), 1_201_000);
  assert.equal(androidVersionCode('1.0.0'), 10_000_999);
  const order = ['0.11.0', '0.12.0-rc.1', '0.12.0', '0.12.1-dev.abc', '0.12.1', '0.13.0', '1.0.0'];
  const codes = order.map(androidVersionCode);
  assert.deepEqual(
    [...codes].sort((a, b) => a - b),
    codes,
  );
  // Past the room each part has, there is no code rather than a wrong one.
  assert.throws(() => androidVersionCode('0.100.0'), /no Android version code/);
  assert.throws(() => androidVersionCode('0.1.100'), /no Android version code/);
});

/** What scripts/build-version.sh says for a version file and GitLab's variables. */
function buildVersion(current, env) {
  const dir = mkdtempSync(join(tmpdir(), 'pecklist-version-'));
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

test('a hash of digits only gets a letter, so the build is still a version', () => {
  // Main's 03262935 (2026-11-01) made 0.4.1-edge.03262935, which .NET refused: SemVer forbids a
  // leading zero in a numeric identifier.
  const main = { CI_COMMIT_BRANCH: 'main' };
  for (const [sha, version] of [
    ['03262935', '0.4.1-edge.g03262935'],
    ['12345678', '0.4.1-edge.g12345678'],
    ['0a2b3c4d', '0.4.1-edge.0a2b3c4d'],
  ]) {
    const built = buildVersion('0.4.0', { ...main, CI_COMMIT_SHORT_SHA: sha });
    assert.equal(built, version);
    assert.ok(SEMVER.test(built), built);
  }
});

test('the release commit on main builds exactly its version, because the tag names that image', () => {
  const merge =
    "Merge branch 'release/0.8.0' into 'main'\n\nchore(release): 0.8.0\n\nSee merge request x!1";
  const on = {
    CI_COMMIT_BRANCH: 'main',
    CI_DEFAULT_BRANCH: 'main',
    CI_COMMIT_SHORT_SHA: 'abc12345',
  };
  assert.equal(buildVersion('0.8.0', { ...on, CI_COMMIT_MESSAGE: merge }), '0.8.0');
  assert.equal(
    buildVersion('0.8.0-rc.1', {
      ...on,
      CI_COMMIT_MESSAGE: 'chore(release): 0.8.0-rc.1',
    }),
    '0.8.0-rc.1',
  );
  // The next commit on main, the same message on a branch, or a passing mention stay as they were.
  assert.equal(
    buildVersion('0.8.0', { ...on, CI_COMMIT_MESSAGE: 'fix: y' }),
    '0.8.1-edge.abc12345',
  );
  assert.equal(
    buildVersion('0.8.0', { ...on, CI_COMMIT_BRANCH: 'release/0.8.0', CI_COMMIT_MESSAGE: merge }),
    '0.8.1-dev.abc12345',
  );
  assert.equal(
    buildVersion('0.8.0', { ...on, CI_COMMIT_MESSAGE: 'fix: after chore(release): 0.8.0' }),
    '0.8.1-edge.abc12345',
  );
  assert.equal(
    buildVersion('0.9.0', { ...on, CI_COMMIT_MESSAGE: 'chore(release): 0.8.0' }),
    '0.9.1-edge.abc12345',
  );
});

test('a release tag builds exactly its version', () => {
  assert.equal(buildVersion('0.2.0', { CI_COMMIT_TAG: 'v0.2.0+20261025' }), '0.2.0');
  assert.equal(buildVersion('0.3.0-rc.1', { CI_COMMIT_TAG: 'v0.3.0-rc.1+20261101' }), '0.3.0-rc.1');
});

test('a release with a feature is a minor one; fixes and dependency bumps alone, a patch', () => {
  const fixes = [
    'fix(sync): time requests out',
    'chore(deps): update .net packages',
    'docs: notes',
  ];
  assert.equal(releaseKind('0.2.10', fixes), 'patch');
  assert.equal(nextVersion('0.2.10', fixes), '0.2.11');
  const withFeature = [...fixes, 'feat: hide the Closed group\n\nA long press on its header.'];
  assert.equal(releaseKind('0.2.10', withFeature), 'minor');
  assert.equal(nextVersion('0.2.10', withFeature), '0.3.0');
  assert.equal(nextVersion('0.2.10', ['feat(notifications): a button on every notice']), '0.3.0');
  // Breaking before 1.0 counts as a feature; from 1.0 on it is a major.
  assert.equal(nextVersion('0.9.4', ['fix!: drop the old sync route']), '0.10.0');
  assert.equal(nextVersion('1.4.2', ['fix: x\n\nBREAKING CHANGE: the old route is gone']), '2.0.0');
  assert.equal(nextVersion('1.4.2', ['feat: x']), '1.5.0');
  // A pre-release releases as its own version.
  assert.equal(nextVersion('0.3.0-rc.1', ['fix: y']), '0.3.0');
  // "feature" in a fix's words is not a feature.
  assert.equal(releaseKind('0.2.10', ['fix: the feature flag check']), 'patch');
});
