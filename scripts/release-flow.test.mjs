// pnpm test:scripts: the checks a release passes on its way from commit to published.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutProblems, releasedAtFor } from './ci/cut-release.mjs';
import { labelProblem, promotedTags } from './ci/promote-image.mjs';
import { digestOfRelease, downloadLinks, imageDigestLink } from './ci/release-page.mjs';
import { releaseProblems } from './release-guard.mjs';
import { plannedVersion } from './versions.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const image = 'registry.gitlab.com/killswitch10/pecklist';

const release = (overrides = {}) => ({
  changes: [
    { path: 'CHANGELOG.md', added: 40, removed: 0 },
    { path: 'web/package.json', added: 1, removed: 1 },
    { path: 'web/src/core/workspace.ts', added: 1, removed: 1 },
    { path: 'server/Directory.Build.props', added: 1, removed: 1 },
    { path: 'website/versions.json', added: 1, removed: 0 },
    { path: 'website/versioned_docs/version-0.8.0/index.md', added: 90, removed: 0 },
    { path: 'website/versioned_sidebars/version-0.8.0-sidebars.json', added: 30, removed: 0 },
  ],
  title: 'chore(release): 0.8.0',
  versions: ['0.8.0', '0.8.0', '0.8.0'],
  ...overrides,
});

test('a release merge request holds the version, the changelog and the docs copy, nothing else', () => {
  assert.deepEqual(releaseProblems(release()), []);
});

test('code on a release branch fails the guard, so the branch name cannot dodge the tests', () => {
  const [problem] = releaseProblems(
    release({ changes: [{ path: 'server/src/Secret.cs', added: 3, removed: 0 }] }),
  );
  assert.match(problem, /server\/src\/Secret\.cs is not part of a release/);
});

test('a change hidden inside a version file fails the guard', () => {
  const [problem] = releaseProblems(
    release({ changes: [{ path: 'web/src/core/workspace.ts', added: 2, removed: 1 }] }),
  );
  assert.match(problem, /changes more than its version/);
});

test('a title that would not stamp the build fails the guard', () => {
  const [problem] = releaseProblems(release({ title: 'Release 0.8.0' }));
  assert.match(problem, /must be "chore\(release\): 0\.8\.0"/);
});

test('version files that disagree fail the guard', () => {
  const problems = releaseProblems(release({ versions: ['0.8.0', '0.7.0', '0.8.0'] }));
  assert.match(problems[0], /differ/);
});

const cut = (overrides = {}) => ({
  versions: ['0.8.0', '0.8.0', '0.8.0'],
  message:
    "Merge branch 'release/0.8.0' into 'main'\n\nchore(release): 0.8.0\n\nSee merge request x!1",
  imageVersion: '0.8.0',
  digest,
  existingTags: [],
  notes: '### Added',
  deployedToTest: true,
  ...overrides,
});

test('a release commit that was built, stamped and deployed can be cut', () => {
  assert.deepEqual(cutProblems(cut()), []);
});

test('only the release commit can be cut', () => {
  const [problem] = cutProblems(
    cut({ message: 'fix: something\n\nmentions chore(release): 0.8.0' }),
  );
  assert.match(problem, /not the release commit/);
});

test('an image stamped otherwise cannot be cut', () => {
  const [problem] = cutProblems(cut({ imageVersion: '0.8.1-edge.abc' }));
  assert.match(problem, /says 0\.8\.1-edge\.abc, not 0\.8\.0/);
});

test('a commit with no recorded digest cannot be cut', () => {
  assert.match(cutProblems(cut({ digest: undefined }))[0], /no image digest/);
});

test('a version already released cannot be cut again', () => {
  const [problem] = cutProblems(cut({ existingTags: ['v0.8.0+20261101'] }));
  assert.match(problem, /already released: v0\.8\.0\+20261101/);
});

test('a commit the test server never took cannot be cut, and says what to do', () => {
  assert.match(cutProblems(cut({ deployedToTest: false }))[0], /retry deploy-test/);
});

const v070 = { tag_name: 'v0.7.0+20261104', released_at: '2026-11-04T01:41:47.568Z' };
const v060 = { tag_name: 'v0.6.0+20261103', released_at: '2026-11-03T18:36:21.468Z' };

test('a pre-release is dated before the newest full release, so it never becomes the latest', () => {
  assert.equal(releasedAtFor(true, [v070, v060]), '2026-11-04T00:41:47.568Z');
});

test('each pre-release shows above the one before it, and still below the full release', () => {
  const rc1 = { tag_name: 'v0.8.0-rc.1+20261106', released_at: '2026-11-04T00:41:47.568Z' };
  const rc2 = { tag_name: 'v0.8.0-rc.2+20261106', released_at: '2026-11-04T00:41:48.568Z' };
  const rc3 = releasedAtFor(true, [v070, rc2, rc1, v060]);
  assert.equal(rc3, '2026-11-04T00:41:49.568Z');
  assert.ok(Date.parse(rc3) > Date.parse(rc2.released_at));
  assert.ok(Date.parse(rc3) < Date.parse(v070.released_at));
});

test('a pre-release dated after the full release does not pull the next one up with it', () => {
  // What happened: rc.1 had its real date, so it was the latest, and rc.2 went below it.
  const stray = { tag_name: 'v0.8.0-rc.1+20261106', released_at: '2026-11-06T01:41:32.454Z' };
  assert.equal(releasedAtFor(true, [stray, v070, v060]), '2026-11-04T00:41:47.568Z');
});

test('pre-releases for an older release leave the next one where it starts', () => {
  const older = { tag_name: 'v0.7.0-rc.1+20261103', released_at: '2026-11-03T17:36:21.468Z' };
  assert.equal(releasedAtFor(true, [v070, v060, older]), '2026-11-04T00:41:47.568Z');
});

test('a pre-release never reaches the full release, however many there are', () => {
  const last = { tag_name: 'v0.8.0-rc.9+20261106', released_at: '2026-11-04T01:41:46.568Z' };
  assert.equal(releasedAtFor(true, [v070, last]), '2026-11-04T01:41:46.568Z');
});

test('a release is dated now, and so is a pre-release with no full release before it', () => {
  assert.equal(releasedAtFor(false, [v070]), undefined);
  assert.equal(releasedAtFor(true, []), undefined);
  assert.equal(
    releasedAtFor(true, [{ tag_name: 'v0.1.0-rc.1+1', released_at: v070.released_at }]),
    undefined,
  );
});

test('a release names its digest in the link the compose repository and promote-image read', () => {
  const link = imageDigestLink(image, '0.8.0', digest);
  assert.equal(link.name, 'image-digest');
  assert.ok(link.url.endsWith(`@${digest}`));
  assert.equal(digestOfRelease({ assets: { links: [link] } }), digest);
});

test('a release with no digest link, or a malformed one, names nothing', () => {
  assert.equal(digestOfRelease({ assets: { links: [] } }), null);
  const bad = { name: 'image-digest', url: 'https://x:0.8.0@sha256:short' };
  assert.equal(digestOfRelease({ assets: { links: [bad] } }), null);
  assert.equal(digestOfRelease(null), null);
});

test('download links keep the stable paths that latest-download links use', () => {
  const [apk, sums] = downloadLinks('https://api', '0.8.0-abc', [
    'pecklist-android.apk',
    'SHA256SUMS',
  ]);
  assert.equal(apk.direct_asset_path, '/pecklist-android.apk');
  assert.equal(apk.url, 'https://api/packages/generic/pecklist/0.8.0-abc/pecklist-android.apk');
  assert.equal(sums.name, 'SHA256SUMS (checksums)');
});

test('a release gets its version, its minor line and latest; a pre-release only its own name', () => {
  assert.deepEqual(promotedTags('0.8.0', false), ['0.8.0', '0.8', 'latest']);
  assert.deepEqual(promotedTags('0.8.0-rc.1', true), ['0.8.0-rc.1', 'rc']);
  assert.deepEqual(promotedTags('0.9.0-beta.2', true), ['0.9.0-beta.2', 'beta']);
  // A pre-release of no named type has only its exact tag: it names no type to hold.
  assert.deepEqual(promotedTags('0.8.0-1', true), ['0.8.0-1']);
});

test('an image from another version or commit is not promoted', () => {
  const labels = {
    'org.opencontainers.image.version': '0.8.0',
    'org.opencontainers.image.revision': 'abc',
  };
  assert.equal(labelProblem(labels, '0.8.0', 'abc'), null);
  assert.match(labelProblem(labels, '0.9.0', 'abc'), /says version 0\.8\.0, not 0\.9\.0/);
  assert.match(labelProblem(labels, '0.8.0', 'def'), /built from abc, not def/);
  assert.match(labelProblem(undefined, '0.8.0', 'abc'), /says version nothing/);
});

test('a version prepared but never cut is prepared again, not skipped over', () => {
  assert.equal(plannedVersion('0.8.0', ['feat: x'], false), '0.8.0');
  assert.equal(plannedVersion('0.8.0', ['feat: x'], true), '0.9.0');
  assert.equal(plannedVersion('0.8.0', ['fix: x'], true), '0.8.1');
  // A pre-release moves on to its release either way.
  assert.equal(plannedVersion('0.8.0-rc.1', ['fix: x'], false), '0.8.0');
  assert.equal(plannedVersion('0.8.0-rc.1', ['fix: x'], true), '0.8.0');
});
