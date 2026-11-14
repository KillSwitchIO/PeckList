import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
import test from 'node:test';

const script = join(import.meta.dirname, 'ci', 'windows-installer.sh');
const haveTools = ['sh', 'zip', 'unzip'].every(
  (tool) => spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0,
);

/** The three portable zips as package.sh makes them, a stand-in compiler and winepath on PATH. */
function setUp({ leaveOut } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pecklist-installer-'));
  const dist = join(dir, 'dist');
  const stage = join(dir, 'stage');
  const bin = join(dir, 'bin');
  for (const folder of [dist, bin, join(stage, 'pecklist-server-win-x64', 'examples')])
    mkdirSync(folder, { recursive: true });
  const files = {
    'pecklist-server-win-x64/pecklist.exe': 'server',
    'pecklist-server-win-x64/examples/pecklist.conf': 'conf',
    'pecklist-cli-win-x64/pecklist.exe': 'cli x64',
    'pecklist-cli-win-arm64/pecklist.exe': 'cli arm64',
  };
  for (const [file, text] of Object.entries(files)) {
    if (file === leaveOut) continue;
    mkdirSync(join(stage, file, '..'), { recursive: true });
    writeFileSync(join(stage, file), text);
  }
  for (const name of [
    'pecklist-server-win-x64',
    'pecklist-cli-win-x64',
    'pecklist-cli-win-arm64',
  ]) {
    execFileSync('zip', ['-qr', join(dist, `${name}-portable.zip`), name], { cwd: stage });
  }
  // winepath -w: Z: and backslashes, as Wine does. The compiler records its arguments and writes
  // the installer where /O says.
  writeFileSync(
    join(bin, 'winepath'),
    String.raw`#!/bin/sh
printf 'Z:%s\n' "$2" | sed 's#/#\\#g'
`,
  );
  writeFileSync(
    join(bin, 'fake-iscc'),
    String.raw`#!/bin/sh
printf '%s\n' "$@" > "$ISCC_LOG"
for a in "$@"; do
  case "$a" in /O*) out=$(printf '%s' "$a" | sed -e 's#^/O##' -e 's#^Z:##' -e 's#\\#/#g') ;; esac
done
[ -n "$NO_OUTPUT" ] || echo exe > "$out/pecklist-setup-x64.exe"
`,
  );
  chmodSync(join(bin, 'winepath'), 0o755);
  chmodSync(join(bin, 'fake-iscc'), 0o755);
  return { dir, dist, bin, log: join(dir, 'iscc.log'), out: join(dir, 'out') };
}

function run(setup, version = '0.12.0-rc.1', env = {}) {
  return spawnSync('sh', [script, version, setup.dist, setup.out], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${setup.bin}:${process.env.PATH}`,
      ISCC: 'fake-iscc',
      ISCC_LOG: setup.log,
      ...env,
    },
  });
}

test(
  'the installer is compiled from the three portable zips, with the version and both command lines',
  { skip: !haveTools },
  () => {
    const setup = setUp();
    const result = run(setup);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(setup.out, 'pecklist-setup-x64.exe')));
    const args = readFileSync(setup.log, 'utf8').trim().split('\n');
    assert.ok(args.includes('/DAppVersion=0.12.0-rc.1'));
    assert.ok(args.includes('/DNumericVersion=0.12.0.0'));
    assert.ok(args.some((arg) => /^\/DServerDir=Z:\\.*\\pecklist-server-win-x64$/.test(arg)));
    assert.ok(
      args.some((arg) => /^\/DCliX64=Z:\\.*\\pecklist-cli-win-x64\\pecklist\.exe$/.test(arg)),
    );
    assert.ok(
      args.some((arg) => /^\/DCliArm64=Z:\\.*\\pecklist-cli-win-arm64\\pecklist\.exe$/.test(arg)),
    );
    assert.ok(args.at(-1).endsWith('\\script\\pecklist.iss'));
    // It leaves SHA256SUMS to upload-downloads.
    assert.ok(!existsSync(join(setup.dist, 'SHA256SUMS')));
  },
);

test('a missing file or a compiler that made nothing fails the job', { skip: !haveTools }, () => {
  const missing = run(setUp({ leaveOut: 'pecklist-server-win-x64/examples/pecklist.conf' }));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no pecklist-server-win-x64\/examples\/pecklist\.conf/);
  const nothing = run(setUp(), '0.12.0', { NO_OUTPUT: '1' });
  assert.notEqual(nothing.status, 0);
  assert.match(nothing.stderr, /made no pecklist-setup-x64\.exe/);
});
