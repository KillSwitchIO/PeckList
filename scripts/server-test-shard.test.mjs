// scripts/ci/server-test-shard.sh and its class list: the three server-test jobs between them run
// every test class once. Checked with a stand-in dotnet that records what it was asked to run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');
const script = join(root, 'scripts', 'ci', 'server-test-shard.sh');
const testsDir = join(root, 'server', 'tests', 'PeckList.Server.Tests');

/** The class list: [shard, class] pairs, comments and blank lines left out. */
function listed() {
  return readFileSync(join(testsDir, 'shards.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/));
}

const fakeDotnet = `#!/bin/sh
echo "$(basename "$PWD") $*" >> "$LOG"
for failing in $FAIL; do
  case "$*" in *"$failing.dll"*) exit 1 ;; esac
done
exit 0
`;

function run(...args) {
  const dir = mkdtempSync(join(tmpdir(), 'shard-'));
  writeFileSync(join(dir, 'dotnet'), fakeDotnet);
  chmodSync(join(dir, 'dotnet'), 0o755);
  const log = join(dir, 'log');
  writeFileSync(log, '');
  const result = spawnSync('sh', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      LOG: log,
      FAIL: process.env.FAIL_PROJECT ?? '',
    },
  });
  return { ...result, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

test('every listed class exists, once, in shard 1 or 2', () => {
  const sources = readdirSync(testsDir)
    .filter((name) => name.endsWith('.cs'))
    .map((name) => readFileSync(join(testsDir, name), 'utf8'))
    .join('\n');
  const names = listed().map(([shard, name]) => {
    assert.match(shard, /^[12]$/, `${name}: shard 1 or 2 (shard 3 is everything else)`);
    assert.match(
      sources,
      new RegExp(`\\bclass ${name}\\b`),
      `${name} is not a class in PeckList.Server.Tests`,
    );
    return name;
  });
  assert.equal(new Set(names).size, names.length, 'a class is listed twice');
});

test('shards 1 and 2 build the server tests and run only their own classes', () => {
  for (const shard of ['1', '2']) {
    const { status, calls } = run(shard);
    assert.equal(status, 0);
    assert.match(calls[0], /^server build tests\/PeckList.Server.Tests --configuration Release/);
    assert.equal(calls.length, 2);
    const mine = listed()
      .filter(([each]) => each === shard)
      .map(([, name]) => name);
    const expected = mine.map((name) => `-class PeckList.Server.Tests.${name}`).join(' ');
    assert.equal(
      calls[1],
      `PeckList.Server.Tests bin/Release/net10.0/PeckList.Server.Tests.dll -maxthreads 4 ${expected}`,
    );
  }
});

test('shard 3 runs the other projects and every class the list leaves out', () => {
  const { status, calls } = run('3');
  assert.equal(status, 0);
  assert.match(calls[0], /^server build --configuration Release/);
  const others = readdirSync(join(root, 'server', 'tests')).filter(
    (name) => name !== 'PeckList.Server.Tests',
  );
  for (const project of others)
    assert.ok(
      calls.some((call) => call.startsWith(`${project} `)),
      project,
    );
  const server = calls.find((call) => call.startsWith('PeckList.Server.Tests '));
  for (const [, name] of listed())
    assert.ok(server.includes(`-class- PeckList.Server.Tests.${name}`), name);
  assert.ok(!/ -class /.test(server));
});

test('a failing project fails the shard, after the rest have run', () => {
  process.env.FAIL_PROJECT = 'PeckList.Core.Tests';
  try {
    const { status, calls } = run('3');
    assert.equal(status, 1);
    assert.ok(calls.some((call) => call.startsWith('PeckList.Server.Tests ')));
  } finally {
    delete process.env.FAIL_PROJECT;
  }
});

test('the threads can be set, and a bad shard is refused', () => {
  process.env.SERVER_TEST_THREADS = '2';
  try {
    assert.match(run('1').calls[1], / -maxthreads 2 /);
  } finally {
    delete process.env.SERVER_TEST_THREADS;
  }
  for (const bad of [[], ['4'], ['x']]) {
    const { status, stderr } = run(...bad);
    assert.equal(status, 2);
    assert.match(stderr, /usage/);
  }
});
