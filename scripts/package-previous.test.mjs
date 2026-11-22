// scripts/ci/package-previous.sh, the upgrade test's starting point (PL-132): a release's packages,
// trusted only once its signed SHA256SUMS checks out and each package matches it. Releases are
// folders served over file://, the releases list a JSON file, and cosign a stand-in that fails
// when told to.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = join(import.meta.dirname, 'ci', 'package-previous.sh');
// The script takes plain file:// URLs (sh can't decode %7E), so not pathToFileURL, which encodes
// the ~ of a Windows short path (C:\Users\KILLSW~1).
const fileUrl = (path) => `file://${path.startsWith('/') ? '' : '/'}${path.replaceAll('\\', '/')}`;
const packages = [
  'pecklist_amd64.deb',
  'pecklist-cli_amd64.deb',
  'pecklist.x86_64.rpm',
  'pecklist-cli.x86_64.rpm',
];
const versionedName = (name, version) =>
  name.endsWith('.deb')
    ? name.replace('_amd64', `_${version}_amd64`)
    : name.replace('.x86_64', `-${version}.x86_64`);

const fakeCosign = `#!/bin/sh
if [ "$1" = version ]; then echo "GitVersion:    v3.1.4"; exit 0; fi
echo "$*" >> "$LOG"
for failing in $FAIL; do [ "$failing" = "$1" ] && exit 1; done
exit 0
`;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// A release folder like a release page's downloads: each package under its plain and versioned
// name in SHA256SUMS, and the bundle unless it was unsigned.
function makeRelease(folder, version, { signed = true } = {}) {
  mkdirSync(folder, { recursive: true });
  const sums = [];
  for (const name of packages) {
    const body = `the ${name} of ${version}\n`;
    writeFileSync(join(folder, name), body);
    sums.push(`${sha256(body)}  ${name}`, `${sha256(body)}  ${versionedName(name, version)}`);
  }
  writeFileSync(join(folder, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  if (signed) writeFileSync(join(folder, 'SHA256SUMS.sigstore.json'), '{"fake":true}\n');
}

// latest is the release the permalink points at; older are earlier releases by tag, newest
// first, which the releases list names (with the latest and a pre-release among them, as GitLab's
// does). change() edits the latest folder before the run.
function run({
  version = '0.15.0-dev.abc1234',
  latest = { version: '0.14.0' },
  older = [],
  env = {},
  change = () => {},
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'package-previous-'));
  const pages = join(dir, 'pages');
  const out = join(dir, 'out');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cosign'), fakeCosign);
  chmodSync(join(bin, 'cosign'), 0o755);
  const latestFolder = join(dir, 'latest');
  makeRelease(latestFolder, latest.version, latest);
  change(latestFolder);
  for (const release of older) {
    makeRelease(join(pages, `v${release.version}`, 'downloads'), release.version, release);
  }
  const listed = [
    `v${latest.version}`,
    'v0.14.0-rc.2',
    ...older.map((release) => `v${release.version}`),
  ];
  writeFileSync(
    join(dir, 'releases.json'),
    JSON.stringify(listed.map((tag) => ({ name: tag, tag_name: tag, upcoming_release: false }))),
  );
  const log = join(dir, 'calls');
  const result = spawnSync('sh', [script, out, version], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      LOG: log,
      SIGSTORE_RETRY_WAITS: '0 0',
      PREVIOUS_RETRY_WAIT: '0',
      PREVIOUS_DOWNLOADS: fileUrl(latestFolder),
      PREVIOUS_PAGES: fileUrl(pages),
      PREVIOUS_RELEASES: fileUrl(join(dir, 'releases.json')),
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  const got = packages.filter((name) => existsSync(join(out, name)));
  const read = (name) =>
    existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf8') : null;
  return { ...result, calls, got, previous: read('VERSION')?.trim() ?? null, read, out };
}

test("the latest release's four packages, once its SHA256SUMS verifies as main's", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.got, packages);
  assert.equal(result.previous, '0.14.0');
  assert.equal(result.read('pecklist_amd64.deb'), 'the pecklist_amd64.deb of 0.14.0\n');
  assert.equal(result.calls.length, 1);
  assert.match(
    result.calls[0],
    /^verify-blob --bundle \S+SHA256SUMS\.sigstore\.json --certificate-identity=https:\/\/gitlab\.com\/killswitch10\/pecklist\/\/\.gitlab-ci\.yml@refs\/heads\/main /,
  );
  assert.match(result.stdout, /starts from 0\.14\.0/);
});

test('a package that does not match SHA256SUMS stops it, and is not left behind', () => {
  const result = run({
    change: (release) => writeFileSync(join(release, 'pecklist.x86_64.rpm'), 'swapped\n'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pecklist\.x86_64\.rpm of 0\.14\.0 does not match SHA256SUMS/);
  assert.ok(!existsSync(join(result.out, 'pecklist.x86_64.rpm')));
  assert.equal(result.previous, null);
});

test('a bundle that does not verify stops it, with no going back to an older release', () => {
  const result = run({ env: { FAIL: 'verify-blob' }, older: [{ version: '0.13.0' }] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA256SUMS of 0\.14\.0 is not the pipeline's/);
  assert.deepEqual(result.got, []);
});

test('a latest release made while Sigstore was down: the newest earlier signed one, said plainly', () => {
  const result = run({
    latest: { version: '0.14.0', signed: false },
    older: [{ version: '0.13.1', signed: false }, { version: '0.13.0' }, { version: '0.12.0' }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.previous, '0.13.0');
  assert.equal(result.read('pecklist.x86_64.rpm'), 'the pecklist.x86_64.rpm of 0.13.0\n');
  assert.match(result.stdout, /Release 0\.14\.0 has no SHA256SUMS\.sigstore\.json/);
  assert.match(result.stdout, /Release 0\.13\.1 has no SHA256SUMS\.sigstore\.json/);
  assert.match(result.stdout, /starts from 0\.13\.0/);
  // Only the signed one was checked, and the pre-release on the list was never tried.
  assert.equal(result.calls.length, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /rc\.2/);
});

test('no signed release at all stops it', () => {
  const result = run({
    latest: { version: '0.14.0', signed: false },
    older: [{ version: '0.13.0', signed: false }],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no earlier final release with a signed SHA256SUMS/);
  assert.deepEqual(result.got, []);
});

test("a release commit's job run again after its release is out starts from the release before", () => {
  const result = run({ version: '0.14.0', older: [{ version: '0.13.0' }] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.previous, '0.13.0');
  assert.match(result.stdout, /Release 0\.14\.0 is this build's own version, so passing over it/);
});
