// scripts/ci/sigstore.sh, the one signing step every job shares (PL-009, PL-132), against a stand-in
// cosign that records how it was called. The real keyless signing needs a pipeline's identity token,
// so the release commit's pipeline is its first real run; this pins everything around it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = join(import.meta.dirname, 'ci', 'sigstore.sh');

// A cosign that logs each call (one line, arguments joined by spaces) and the password it read,
// writes a bundle when asked, and fails the commands named in FAIL (sign-blob, sign, verify...).
const fakeCosign = `#!/bin/sh
if [ "$1" = version ]; then echo "GitVersion:    v\${FAKE_VERSION:-3.1.4}"; exit 0; fi
echo "$*" >> "$LOG"
if [ -n "\${SSL_CERT_FILE:-}" ]; then
  echo "$SSL_CERT_FILE $(grep -c 'BEGIN CERTIFICATE' "$SSL_CERT_FILE")" > "$LOG.ssl"
else
  echo "" > "$LOG.ssl"
fi
case "$1" in
  login) cat > "$LOG.password" ;;
esac
for failing in $FAIL; do
  [ "$failing" = "$1" ] && exit 1
done
if [ "$1" = sign-blob ]; then
  while [ $# -gt 0 ]; do
    [ "$1" = --bundle ] && echo '{"fake":true}' > "$2"
    shift
  done
fi
exit 0
`;

// With offline, a curl that always fails comes first on PATH, so the cosign download fails the same
// way on every machine (a dead proxy is not enough: Node's fetch, used without curl or wget, ignores
// https_proxy).
// PATH_ONLY in env replaces the PATH after the stand-ins (to run without node).
function run(args, { PATH_ONLY, ...env } = {}, { offline = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sigstore-'));
  writeFileSync(join(dir, 'cosign'), fakeCosign);
  chmodSync(join(dir, 'cosign'), 0o755);
  if (offline) {
    writeFileSync(
      join(dir, 'curl'),
      '#!/bin/sh\necho "curl: (7) no network in this test" >&2\nexit 7\n',
    );
    chmodSync(join(dir, 'curl'), 0o755);
  }
  const sums = join(dir, 'SHA256SUMS');
  writeFileSync(sums, 'aaa  pecklist-cli-linux-x64-portable.tar.gz\n');
  const log = join(dir, 'calls');
  const result = spawnSync('sh', [script, ...args.map((arg) => arg.replace('{sums}', sums))], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${PATH_ONLY ?? process.env.PATH}`,
      LOG: log,
      SIGSTORE_ID_TOKEN: 'token',
      SIGSTORE_RETRY_WAITS: '0 0',
      CI_SERVER_URL: 'https://gitlab.com',
      CI_PROJECT_PATH: 'example/pecklist',
      CI_DEFAULT_BRANCH: 'main',
      CI_COMMIT_BRANCH: 'main',
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  const password = existsSync(`${log}.password`) ? readFileSync(`${log}.password`, 'utf8') : null;
  // What cosign was given as SSL_CERT_FILE, and how many certificates the file held while it ran.
  const [certFile = null, certs = '0'] = existsSync(`${log}.ssl`)
    ? readFileSync(`${log}.ssl`, 'utf8').trim().split(' ')
    : [];
  return {
    ...result,
    calls,
    password,
    certFile,
    certs: Number(certs),
    sums,
    bundle: `${sums}.sigstore.json`,
  };
}

test('a file is signed into a bundle beside it, then checked as main of this project', () => {
  const result = run(['blob', '{sums}']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(result.bundle));
  assert.match(
    result.calls[0],
    /^sign-blob --yes --bundle \S+SHA256SUMS\.sigstore\.json \S+SHA256SUMS$/,
  );
  assert.equal(
    result.calls[1].replace(/ \S+$/, ''),
    `verify-blob --bundle ${result.bundle} ` +
      '--certificate-identity=https://gitlab.com/example/pecklist//.gitlab-ci.yml@refs/heads/main ' +
      '--certificate-oidc-issuer https://gitlab.com',
  );
  assert.match(result.stdout, /Signed .*SHA256SUMS/);
});

test("with no system CA bundle (the Node image), cosign gets Node's root certificates", () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sigstore-tmp-'));
  const result = run(['blob', '{sums}'], {
    SIGSTORE_SYSTEM_CA: join(tmp, 'none.crt'),
    TMPDIR: tmp,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.certFile, 'SSL_CERT_FILE was not set for cosign');
  assert.ok(result.certs > 50, `only ${result.certs} roots`);
  assert.match(result.stderr, /No system CA bundle: cosign uses Node's root certificates/);
  assert.ok(!existsSync(result.certFile), 'the roots file was left behind');
});

test(
  'with no system CA bundle and no node, it says why cosign may fail',
  {
    skip: process.platform === 'win32' || existsSync('/usr/bin/node') || existsSync('/bin/node'),
  },
  () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sigstore-tmp-'));
    const result = run(['blob', '{sums}'], {
      SIGSTORE_SYSTEM_CA: join(tmp, 'none.crt'),
      TMPDIR: tmp,
      PATH_ONLY: '/usr/bin:/bin',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.certFile, '');
    assert.match(result.stderr, /No system CA bundle and no node for root certificates/);
  },
);

test('a system CA bundle, or an SSL_CERT_FILE of the job, is left as it is', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sigstore-tmp-'));
  const system = join(tmp, 'ca-certificates.crt');
  writeFileSync(system, '-----BEGIN CERTIFICATE-----\n');
  const withSystem = run(['blob', '{sums}'], { SIGSTORE_SYSTEM_CA: system, TMPDIR: tmp });
  assert.equal(withSystem.status, 0, withSystem.stderr);
  assert.equal(withSystem.certFile, '');
  const own = run(['blob', '{sums}'], {
    SIGSTORE_SYSTEM_CA: join(tmp, 'none.crt'),
    SSL_CERT_FILE: system,
    TMPDIR: tmp,
  });
  assert.equal(own.status, 0, own.stderr);
  assert.equal(own.certFile, system);
});

test('the bundle can go somewhere else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sigstore-out-'));
  const result = run(['blob', '{sums}', join(dir, 'out.sigstore.json')]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(dir, 'out.sigstore.json')));
  assert.ok(!existsSync(result.bundle));
});

test('Sigstore down: three tries, then no bundle, a plain warning and no failed job', () => {
  const result = run(['blob', '{sums}'], { FAIL: 'sign-blob' });
  assert.equal(result.status, 0);
  assert.equal(result.calls.filter((call) => call.startsWith('sign-blob')).length, 3);
  assert.ok(!existsSync(result.bundle));
  assert.match(result.stderr, /NOT SIGNED: .*SHA256SUMS \(Sigstore refused or did not answer/);
});

test('a signature that does not verify is thrown away', () => {
  const result = run(['blob', '{sums}'], { FAIL: 'verify-blob' });
  assert.equal(result.status, 0);
  assert.ok(!existsSync(result.bundle));
  assert.match(
    result.stderr,
    /NOT SIGNED: .*did not verify as https:\/\/gitlab\.com\/example\/pecklist\/\/\.gitlab-ci\.yml@refs\/heads\/main/,
  );
});

test('SIGSTORE_REQUIRED=1 turns not signed into a failure', () => {
  assert.equal(run(['blob', '{sums}'], { FAIL: 'sign-blob', SIGSTORE_REQUIRED: '1' }).status, 1);
  assert.equal(
    run(['blob', '{sums}'], { SIGSTORE_ID_TOKEN: '', SIGSTORE_REQUIRED: '1' }).status,
    1,
  );
});

test('a job without the identity token signs nothing and says how to fix it', () => {
  const result = run(['blob', '{sums}'], { SIGSTORE_ID_TOKEN: '' });
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, []);
  assert.match(result.stderr, /NOT SIGNED: .*add id_tokens with aud: sigstore/);
});

test('off the default branch the check takes any ref of this project, dots escaped', () => {
  const result = run(['blob', '{sums}'], { CI_COMMIT_BRANCH: 'feat/x' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.calls[1],
    / --certificate-identity-regexp=\^https:\/\/gitlab\\\.com\/example\/pecklist\/\/\\\.gitlab-ci\\\.yml@ /,
  );
});

test('an image is signed by digest after a login that takes the password on stdin', () => {
  const image = 'registry.gitlab.com/example/pecklist@sha256:abc';
  const result = run(['image', image], {
    CI_REGISTRY_USER: 'gitlab-ci-token',
    CI_REGISTRY_PASSWORD: 'secret',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    'login registry.gitlab.com -u gitlab-ci-token --password-stdin',
    `sign --yes ${image}`,
    `verify --certificate-identity=https://gitlab.com/example/pecklist//.gitlab-ci.yml@refs/heads/main --certificate-oidc-issuer https://gitlab.com ${image}`,
  ]);
  assert.equal(result.password, 'secret');
  assert.ok(!result.calls.join(' ').includes('secret'));
});

test('an image named by tag is refused: a tag can move, a digest cannot', () => {
  const result = run(['image', 'registry.gitlab.com/example/pecklist:latest'], {
    SIGSTORE_REQUIRED: '1',
  });
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, []);
  assert.match(result.stderr, /sign images by digest/);
});

test('without a mode or target it prints how to call it', () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['blob']).status, 2);
  assert.equal(run(['nonsense', 'x']).status, 2);
});

// --- The signature on the release page ---

test('the bundle is linked beside SHA256SUMS, unversioned, as a plain file', async () => {
  const { SUMS_BUNDLE, downloadLinks } = await import('./ci/release-page.mjs');
  const [, bundle] = downloadLinks('https://api', '0.12.0-abc', '0.12.0', [
    'SHA256SUMS',
    SUMS_BUNDLE,
  ]);
  assert.equal(bundle.name, 'SHA256SUMS.sigstore.json (their signature)');
  assert.equal(bundle.direct_asset_path, '/SHA256SUMS.sigstore.json');
  assert.equal(bundle.link_type, 'other');
  assert.ok(bundle.url.endsWith('/0.12.0-abc/SHA256SUMS.sigstore.json'));
});

test('the release text says what is signed and what is not, and nothing for an old release', async () => {
  const { describeRelease } = await import('./ci/release-page.mjs');
  const base = {
    notes: '## 0.12.0',
    image: 'img',
    version: '0.12.0',
    prerelease: false,
    projectUrl: 'https://p',
  };
  const both = describeRelease({ ...base, signed: true, imageSigned: true });
  assert.match(
    both,
    /`SHA256SUMS` is signed by this project's release pipeline with Sigstore \(`SHA256SUMS\.sigstore\.json`\)\./,
  );
  assert.match(both, /The image is signed by its digest\./);
  // The repository's copy: a pre-release does not update the docs site.
  assert.match(both, /\(https:\/\/p\/-\/blob\/main\/docs\/install\/verifying\.md\)/);

  // Sigstore down: the page says so, so a missing bundle never looks like a removed one.
  const neither = describeRelease({ ...base, signed: false, imageSigned: false });
  assert.match(
    neither,
    /`SHA256SUMS` is not signed: signing did not complete when this release was made\. It still checks the files\./,
  );
  assert.match(neither, /The image is not signed: signing did not complete/);

  // The image claim follows sign-image, not the bundle.
  const sumsOnly = describeRelease({ ...base, signed: true, imageSigned: false });
  assert.match(sumsOnly, /`SHA256SUMS` is signed/);
  assert.match(sumsOnly, /The image is not signed/);

  // A legacy tag rebuild (publish-release.mjs) passes neither: nothing about signing.
  assert.doesNotMatch(describeRelease(base), /Sigstore|signed/);
});

test('a cosign already on PATH is used only when it is the pinned version', () => {
  const pinned = run(['blob', '{sums}']);
  assert.doesNotMatch(pinned.stderr, /Not using/);
  // Another version is passed over for the pinned download, which fails here (offline).
  const other = run(
    ['blob', '{sums}'],
    { FAKE_VERSION: '3.1.40', TMPDIR: mkdtempSync(join(tmpdir(), 'sigstore-dl-')) },
    { offline: true },
  );
  assert.equal(other.status, 0);
  assert.match(other.stderr, /Not using \S+cosign: it is not cosign 3\.1\.4/);
  assert.deepEqual(other.calls, []);
  assert.match(other.stderr, /NOT SIGNED: .*could not be downloaded/);
});

function uploadDownloads(dist, ...args) {
  return spawnSync(
    process.execPath,
    [join(import.meta.dirname, 'ci', 'upload-downloads.mjs'), dist, ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CI_API_V4_URL: 'http://127.0.0.1:9',
        CI_PROJECT_ID: '1',
        CI_JOB_TOKEN: 't',
        CI_COMMIT_SHORT_SHA: 'abc',
      },
    },
  );
}

test('what gets signed is SHA256SUMS exactly as the release page serves it', async () => {
  const { versionedSums } = await import('./ci/release-page.mjs');
  const { readVersions } = await import('./versions.mjs');
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dist, 'SHA256SUMS'), 'aaa  pecklist-android.apk\n');
  const result = uploadDownloads(dist, '--sums-only');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(dist, 'release', 'SHA256SUMS'), 'utf8'),
    versionedSums('aaa  pecklist-android.apk\n', readVersions()[0].version),
  );
});

test('a bundle that signs other sums stops the upload before anything goes up', () => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dist, 'SHA256SUMS'), 'aaa  pecklist-android.apk\n');
  assert.equal(uploadDownloads(dist, '--sums-only').status, 0);
  writeFileSync(join(dist, 'SHA256SUMS.sigstore.json'), '{}');
  writeFileSync(join(dist, 'SHA256SUMS'), 'bbb  pecklist-android.apk\n');
  const result = uploadDownloads(dist);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signs a different SHA256SUMS than the one being uploaded/);
  assert.doesNotMatch(result.stdout, /uploaded/);
});

// --- When a pre-release was really published (its GitLab date is earlier on purpose) ---

test('a pre-release page says when it was really published, and why GitLab shows an earlier date', async () => {
  const { describeRelease } = await import('./ci/release-page.mjs');
  const base = {
    notes: '## 0.11.0-rc.1',
    image: 'img',
    version: '0.11.0-rc.1',
    projectUrl: 'https://p',
  };
  const page = describeRelease({
    ...base,
    prerelease: true,
    publishedAt: '2026-11-12T10:02:04.097Z',
  });
  assert.match(
    page,
    /Published 2026-11-12 10:02 UTC\. GitLab lists a pre-release just before the newest full release/,
  );
  assert.doesNotMatch(
    describeRelease({ ...base, prerelease: false, publishedAt: '2026-11-12T10:02:04.097Z' }),
    /Published/,
  );
});
